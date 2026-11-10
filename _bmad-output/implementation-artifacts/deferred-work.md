# Deferred Work

This backlog records work that remains open, grouped by area.
Entries use `- source_spec: <path in backticks> | none`, followed by one-line `summary:` and `evidence:` fields and an optional `resolved_by:` field.
Completed and obsolete items are removed; their history is in git.

## Deploy & host

- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Document the admin user's passwordless sudo grant and the first-connection TOFU host-key acceptance (`StrictHostKeyChecking=accept-new`) as deliberate tradeoffs, and add a break-glass recovery procedure for an SSH lockout.
  evidence: Both are real, currently-undocumented security-relevant decisions in `bootstrap-host.sh`/`provision-host.sh`; `deploy/README.md` only warns "do not remove the only permitted CIDR" with no recovery path if it happens anyway.

- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Harden `provision-host.sh`'s Hetzner-API interactions: distinguish a transient/auth `hcloud describe` failure from a genuine "not found" before creating resources, detect firewalls shared via a label selector (not just direct server attachment), validate the permission bits of the referenced SSH key files, and give an explicit error when `ssh-keygen -y` blocks on a passphrase-protected key.
  evidence: Each is a real edge case identified during review (confirmed by tracing the script logic) that could cause a duplicate resource, an undetected shared firewall, or an opaque hang/failure, but none are required by the story's stated acceptance criteria.

- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Extend `deploy/tests/test_host_baseline.sh` to actually execute `bootstrap-host.sh`'s CIDR/key validation logic and to exercise the admin-user (sudo-prefixed) provisioning path, not only the root-fallback path.
  evidence: Confirmed while fixing the test's SSH stub during this review — the suite only `grep`-matches literal strings in `bootstrap-host.sh` and never runs its validation functions, and the stub always lets the root probe succeed first, so the admin/sudo code path in `provision-host.sh` has never actually been exercised by this test.

- source_spec: `_bmad-output/implementation-artifacts/spec-0-2-make-django-production-ready.md`
  summary: Deploy-check the real runtime configuration (e.g. `DJANGO_KEY` strength, `security.W009`), not just build placeholders.
  evidence: Image build and CI both run `check --deploy` with placeholder values; the runtime only enforces presence. Pre-existing.

- source_spec: `_bmad-output/implementation-artifacts/spec-0-5-build-the-private-compose-runtime.md`
  summary: Add an operator-approved retention and cleanup workflow for superseded content-addressed runtime snapshots after secret rotation.
  evidence: Snapshot lifecycle is a distinct operational policy requiring rollback-retention decisions; Story 0-5 safely creates immutable snapshots but does not delete prior secret material automatically.

- source_spec: `_bmad-output/implementation-artifacts/spec-0-6-implement-safe-blue-green-deployment.md`
  summary: Extend the supported runtime-configuration rotation to adopt the new snapshot in both slots with overlap for compatibility-affecting keys.
  evidence: Both-slot adoption of the new snapshot with overlap for compatibility-affecting keys remains unsupported. Partly shipped in `0a35899`: `release.sh deploy --rotate-config` and the README procedure rotate the candidate while the prior slot retains its old configuration.

- source_spec: `_bmad-output/implementation-artifacts/spec-0-8-add-monitoring-and-operational-controls.md`
  summary: Pin the expected OpenPGP fingerprints of third-party apt signing keys (Docker in `bootstrap-host.sh`, Tailscale in `monitor.sh`) and refuse to install a downloaded key that does not match.
  evidence: Review of 0.8 found `monitor.sh install` trusts whatever key `pkgs.tailscale.com` serves over HTTPS; `bootstrap-host.sh` already does the same for Docker, so this is a pre-existing pattern best fixed for both at once.

## Backup & restore

- source_spec: `_bmad-output/implementation-artifacts/spec-0-7-implement-encrypted-backup-and-restore.md`
  summary: Run an application-level check (`manage.py migrate --check` from the release image) against the database that `verify-restore` restores, in addition to the per-table counts and content checksums.
  evidence: Review of 0.7 noted that a dump restoring with corrupted values but correct row counts would pass; counts satisfy the story's acceptance criteria but do not prove content integrity. Partly shipped in `620fbf8`: content checksums cover every user table; the application-level check remains open. Deferred by the backup/restore integrity spec: the throwaway PostgreSQL runs with `--network none`, so running the app image against it needs a private network and runtime secrets in the restore path; the content checksums already cover `django_migrations` exactly, so this would only add proof that the restored schema matches the code. Sources: `_bmad-output/implementation-artifacts/spec-0-7-implement-encrypted-backup-and-restore.md`; `_bmad-output/implementation-artifacts/spec-deferred-backup-restore-integrity.md`.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-pre-rehearsal-fixes.md`
  summary: Decide whether a host-state failure should keep that night's database dump and manifest (recording a degraded `host-state` result) instead of discarding the whole backup run.
  evidence: Review found that a deploy overlapping the nightly backup (a `.prev` record or snapshot removed between collection and `tar`) fails the run at `host-state` and discards a good `mawareeth.dump`, pushing the effective RPO to 48h; the approved intent chose fail-the-whole-run, so changing it needs a decision.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-backup-restore-integrity.md`
  summary: Add a CI job (or a docker-gated section of `deploy/tests/test_backup.sh`) that runs the exact `output_settings_sql` + `count_sql` from `backup.sh` on the pinned `POSTGRES_IMAGE`, round-trips the data through `pg_dump -Fc | pg_restore --no-owner --no-acl` into a server with different TimeZone/DateStyle defaults, and asserts every line matches `count_line_re` and that the output is unchanged.
  evidence: Review found that the stub suites only text-match the checksum SQL, so a broken cast or a missing setting would pass CI and surface only as `failed:dump` nightly or `checksum-mismatch` monthly; the round trip was verified once by hand on postgres:17.11 during this story, but nothing repeats it.

- source_spec: `_bmad-output/implementation-artifacts/spec-gh-64-backup-integrity-review-fixes.md`
  summary: Run the backup's count and checksum pass alongside `pg_dump` (both inside the exported snapshot) so the snapshot's xmin horizon is held for max(count, dump) instead of their sum.
  evidence: Deferred by the #64 review-fixes spec ("Never: running the checksum pass concurrently with `pg_dump`"); today `dump_and_count` checksums every table and only then starts `pg_dump --snapshot`, so the REPEATABLE READ transaction, and the vacuum horizon it pins on production, lasts for both passes back to back.

## Monitoring & alerts

- source_spec: `_bmad-output/implementation-artifacts/spec-0-8-add-monitoring-and-operational-controls.md`
  summary: Add external dead-man coverage for the shared p1 SMTP relay so a stopped relay is detected between quarterly alert-path drills.
  evidence: Review of 0.8 noted every host-side Mawareeth alert depends on p1's Prometheus/Alertmanager/SMTP; if any stops, all Mawareeth alerts go silent while Better Stack covers only the public endpoint. Complements the existing quarterly alert-path drill. Partly shipped in `ba2f7c7`: Watchdog/Better Stack cover Prometheus, Alertmanager and reachability; SMTP remains covered only by quarterly drills.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-monitoring-gaps.md`
  summary: Detect collector failures behind the host-health rules (e.g. `node_scrape_collector_success{collector=~"systemd|vmstat|timex|filesystem|meminfo"} == 0`, `node_filesystem_device_error == 1`, or `absent()` guards for the memory, OOM and clock series) so they cannot go quiet unnoticed.
  evidence: Review of the monitoring-gaps change found that only `MawareethSystemdUnitFailed` has an absence guard; if the vmstat, timex, meminfo or filesystem collector fails or drops a series, the OOM, clock, memory, inode and read-only rules can never fire, and nothing reports it.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-monitoring-gaps.md`
  summary: Move the Better Stack heartbeat URL out of `alertmanager.yml` into a root-only file read through `webhook_configs[].url_file`, if p1's Alertmanager version supports it.
  evidence: Review noted that substituting `${MAWAREETH_HEARTBEAT_URL}` puts a bearer URL into the generated config and depends on SCDF's config generator keeping a new variable; p1's Alertmanager version was not checked.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-monitoring-gaps.md`
  summary: Decide whether `MawareethMemoryPressure`'s swap branch (more than 50% of swap used for 10m) should use swap activity (`rate(node_vmstat_pswpin/pswpout)`) or memory PSI instead, since Linux does not free swap after pressure passes.
  evidence: Review found that a host can stay above 50% swap used long after pressure ends, which gives a warning that never resolves; the approved matrix specifies used-swap, so changing it needs a decision. Hetzner Ubuntu images ship without swap, so the branch is dormant until swap is added.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-credential-expiry-alerts.md`
  summary: Extend `monitor.sh token-check` with a read-only probe of the repository's Actions artifacts endpoint, so a token that is alive but lost Actions read or repository access alerts before a deploy fails.
  evidence: Review found that `/rate_limit` returns 200 for any live token, so `MawareethGithubTokenUnhealthy` stays silent for a re-scoped token; the approved spec limits the check to `/rate_limit` to spend no quota, and the runbook now documents the blind spot.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-credential-expiry-alerts.md`
  summary: Alert when a certificate file the running configuration requires disappears (`cert.pem` in cloudflare mode, the AOP files under `ORIGIN_CLIENT_AUTH=require`), for example by comparing file presence with the edge mode.
  evidence: Review found that deleting a required file removes its series, so an active `MawareethOriginCertificateExpiring` resolves and nothing fires until the next preflight; the approved matrix makes an absent file publish nothing, and telling required from unused needs `monitor.sh` to read `runtime.env`, which the spec lists as Ask First.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-credential-expiry-alerts.md`
  summary: Decide whether a token record moving from a dated `expires_epoch` to `never` should be flagged, since a renamed or stripped GitHub expiry header would silently turn off the 30-day token alert.
  evidence: Review found that HTTP 200 without `github-authentication-token-expiration` overwrites a known expiry with `never`; the approved matrix treats a missing header as a never-expiring token, and treating the change as an error would also alert on a legitimate rotation to a non-expiring token.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-credential-expiry-alerts.md`
  summary: Add a `for:` delay or split out the `absent()` branches of the existing `MawareethCollectorStale` and `MawareethDrillOverdue` rules, so one failed scrape cannot fire them before `MawareethHostDown` inhibits them.
  evidence: Review of the new token rule found this false-alarm path and fixed it there with `for: 5m`; both existing rules use `absent()` with no `for:`, and changing existing rules was outside this spec.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Re-run `deploy/monitor.sh install` on the production host when this work ships, confirm `clear-sessions` runs in the real image, and consider a last-success metric for it.
  evidence: The shell tests stub Docker, and a host that never re-runs `install` has no timer and raises no alert, so session rows would grow unnoticed. Release blocker.

## CI

- source_spec: `_bmad-output/implementation-artifacts/spec-cloudflare-origin-lock.md`
  summary: Add a scheduled CI check that compares `deploy/cloudflare-ips.txt` with Cloudflare's published https://www.cloudflare.com/ips-v4 and /ips-v6 and fails (or opens an issue) when they differ.
  evidence: Review noted that with PUBLIC_WEB_SOURCES=cloudflare a new Cloudflare range would make visitors routed through it time out, and nothing flags drift until someone refreshes the file by hand; a CI-side fetch keeps the no-runtime-fetch rule.

- source_spec: `_bmad-output/implementation-artifacts/spec-cloudflare-authenticated-origin-pulls.md`
  summary: Add a CI job that starts Caddy with the cloudflare-aop snippets and a throwaway CA, and proves live that a handshake without a client certificate, or with one from another CA, fails on both names while the throwaway client certificate succeeds.
  evidence: CI only runs `caddy adapt --validate` plus JSON shape checks, and test_release.sh uses a curl stub; the live handshake behaviour was checked once by hand during implementation and is not guarded against regressions.

- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Watch npm dependencies for vulnerabilities and move off `eslint@9`, which npm reports as unsupported.
  evidence: The new `web` job runs no audit and the diff adds no update tooling, so nothing flags a Next or React advisory.

## Edge / Cloudflare

- source_spec: `_bmad-output/implementation-artifacts/spec-cloudflare-authenticated-origin-pulls.md`
  summary: Give the operator a check of Cloudflare's side of per-hostname Authenticated Origin Pulls (both hostnames `enabled` and status `active` via the API, or a probe through Cloudflare), since release.sh's loopback probes present the client certificate themselves and pass even when Cloudflare does not.
  evidence: Review noted a deploy with `require` succeeds while Cloudflare lacks or has lost the hostname association, leaving visitors on 52x; only the manual enablement order protects against it.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Confirm the real `X-Forwarded-For` value reaching Django behind Cloudflare before relying on the case-write throttle's `NUM_PROXIES = 2`.
  evidence: A local Caddy run on 2026-11-06 confirmed Caddy appends the peer from a trusted proxy and replaces the header otherwise, but Cloudflare's own contribution can only be observed on the deployed stack. Release blocker.

## Django / API

- source_spec: none
  summary: Run real end-to-end testing of the OAuth/social-login flow after the oauthlib and social-auth-core major-version upgrades.
  evidence: Both are major-version bumps directly backing `mawareeth/settings.py`'s social-login configuration; flattening `requirements.txt` (this story's earlier fix) made GitHub's dependency graph visible for the first time, surfacing these alerts. Deferred rather than bumped blind because a regression here breaks login, not just a lint check, and this environment has no way to exercise the live OAuth flow end-to-end. Partly shipped in `43eb2f1`, `e39cb3e` and `e800326`: dependency upgrades landed; no end-to-end social-login evidence is recorded.

- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Stop `ResultsView` and `NewResultsView` writing to the database on GET through `compute()`.
  evidence: Touches calculation behavior, which that spec leaves unchanged; Epic 2's pure engine is the natural place to resolve it.

- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Review production access logs for past anonymous writes and cross-account reads on calc routes, since the app keeps no audit trail of them.
  evidence: An operational investigation of possible past exposure, not a code change, and the outcome may require notifying users.

- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Make `calc:new` answer a POST with no `name` field with the existing error message instead of a 500.
  evidence: `request.POST["name"]` raises `MultiValueDictKeyError`; this predates that spec, which only handled the GET replay.

- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Stop the results views running `compute()` before the waffle flag and HTTP method checks, so a flag-off 404 or a POST 405 writes nothing.
  evidence: Both views call `compute()` first in `dispatch`, so an owner's rejected request still writes to the database; this predates that spec.

- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Count production `Calculation` rows with `user=None` and decide what happens to them, since the app now answers 404 for them and only Django admin reaches them.
  evidence: The count was not checked before the change, so the number of affected cases is unknown.

- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Fix the language switcher, which stores the chosen language in the cookie but sends the visitor back to the old language's URL, such as `/en/` after choosing French.
  evidence: Reproduced on production on 2026-11-05 and locally on the code before and after that spec, with the same `302 /en/`; the URL prefix then keeps the page in the old language.

- source_spec: `_bmad-output/implementation-artifacts/spec-calc-access-control.md`
  summary: Make `social:complete` handle a request with no OAuth state instead of returning 500.
  evidence: Reproduced on production on 2026-11-05 and locally on the code before and after that spec; a real login round trip was not tested.

- source_spec: none
  summary: Add an "are you sure?" confirmation before deleting a whole case from the case list, as part of product development, using the confirmation dialog the UX spec defines for destructive actions.
  evidence: `calc:delete` deletes on one click of the trash button, while `heir_delete` and `deceased_delete` already show a confirmation page; `_bmad-output/planning-artifacts/ux-design-specification/ux-consistency-patterns.md:17` requires a confirmation dialog for removing a case. The owner chose on 2026-11-05 to leave this out of the security fix in PR #93 and handle it in product work.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-case-write-integrity.md`
  summary: Decide whether to bound the case write lock wait (for example `SET LOCAL lock_timeout` with a clear "another change is in progress" response) and add a metric or log for lock wait time, before the interview opens widely.
  evidence: `CaseWriteLockMiddleware` waits with no timeout, so one visitor firing many parallel writes, or a hung request inside the lock, ties up workers and DB connections until gunicorn's timeout; the spec put any lock timeout under Ask First, and review flagged the lack of visibility.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-compute-transaction.md`
  summary: Decide whether to bound the `compute()` row-lock wait (for example `SET LOCAL lock_timeout`) on the results pages, which run it on every GET.
  evidence: Overlapping results-page views of one case now wait on `select_for_update()` with no limit, so a slow or stuck run ties up web workers; the spec put any lock timeout under Ask First.

## Calculation engine & proof

- source_spec: `_bmad-output/implementation-artifacts/spec-fix-engine-share-distribution.md`
  summary: Say on the results pages that the shares follow the Hanbali school, whichever school the visitor follows.
  evidence: The legacy calc results views (`ResultsView` and `NewResultsView`) call `compute()` without a school argument, so they use its Hanbali default regardless of the visitor's Madhab setting; neither view labels that school. The engine accepts a school argument (`calc/schools.py`).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-standard-share-calculation-sunni-schools.md`
  summary: Add the Jafari school in its own story: its rules (no awl or radd as the Sunni schools have them, its own order of heirs and blocking), plus the relationships it needs that the engine does not model yet.
  evidence: `compute(madhab='jafari')` raises `UnsupportedCase` with `school_not_supported`. Jafari needs at least the distinction between paternal and maternal lines for grandparents, siblings and uncles, which the current relationship types do not record.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-standard-share-calculation-sunni-schools.md`
  summary: Get a ruling on the Malikiyya (husband, mother or grandmother, grandfather, two or more maternal siblings and a paternal brother) for the Maliki school, then replace the refusal with a result.
  evidence: The case raises `UnsupportedCase` with `malikiyya_disputed` under Maliki. Shafi'i gives the muqasama result (1/2, 1/6, 1/6, 0, 1/6 in the fixture).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-standard-share-calculation-sunni-schools.md`
  summary: Decide whether Maliki should also refuse the family like Malikiyya but with a full brother (Shibh al-Malikiyya), which Story 2.1 calculates by the general grandfather rule.
  evidence: The spec's matrix refuses only the paternal-brother form and says anything unlisted matches Hanbali, but the author's understanding is that Malik rules on the full-brother form the same way, so a Maliki visitor could get a number their school disputes. This needs the qualified review.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Move the preview off database writes to an in-memory engine path before opening it widely.
  evidence: Each anonymous preview creates rows and rolls them back, which advances Postgres sequences and leaves dead rows for vacuum, and a request the browser aborted still runs to the end on the server. It costs about 100 queries for 6 heirs and 645 for 50.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-deterministic-proof-output-for-multi-school-results.md`
  summary: Add hadith, ijma and scholar citations to the proof, where the schools rest on them rather than on a verse.
  evidence: The spec allowed only 4:11, 4:12 and 4:176, so every rule without a verse (the grandfather with siblings, the mushtaraka, the akdariyya, awl and radd) names its school rule and no source text.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-deterministic-proof-output-for-multi-school-results.md`
  summary: Have a qualified reviewer check the proof's codes, the verse given to each relationship, and the Arabic and French labels.
  evidence: `calc/proof.py` and the three `django.po` files are unreviewed. In particular the verse is given by relationship (a grandfather, a grandchild and a grandmother get none), the paternal siblings are put under 4:176, and the labels state fiqh positions for each school.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-deterministic-proof-output-for-multi-school-results.md`
  summary: Say in the proof when a fixed share is split among several heirs of one type (e.g. two wives each with fraction 1/8 and share 1/16), with a count or a 'shared' condition, so the gap between fraction and share is explained.
  evidence: Story 2.2 review found wives and grandmothers keep their single-heir condition while their share is the group's fraction divided among them; changing it alters the version-1 proof contract and every fixture, so it needs its own change.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-expanded-multi-school-coverage-beyond-standard-cases.md`
  summary: Have a qualified reviewer read the grandmother rules, labels and positions added by Story 2.3.
  evidence: Unreviewed: the matrix of grandmother positions (father blocks his mother under Hanafi, Maliki and Shafi'i, not under Hanbali; the mother blocks both; unblocked grandmothers share one sixth), the school-rule codes `father_blocks_his_mother` and `grandmother_inherits_with_her_son` and their three-language labels, the new relationship labels (paternal and maternal grandmother, in Arabic and French) and the new engine and kinship messages in the three `django.po` files. The father rule is tagged on both grandmothers of the family, which a reviewer should confirm.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-maliki-shafii-later-radd.md`
  summary: Have a qualified reviewer and native Arabic and French speakers check the `radd_later_scholars` label ("Later Maliki and Shafi'i scholars: ...", "المتأخرون من المالكية والشافعية ...", "Les savants malikites et chaféites tardifs ...") and whether the plain `radd` label should also say that a spouse takes no radd.
  evidence: The label states a fiqh position for two schools and was written without review; review of this change flagged the French "tardifs" as awkward and the plain radd label as silent on the spouse.

## Interview & web UI

- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Add shadcn/ui, React Query, Zustand and drf-spectacular with the first story that uses each.
  evidence: The foundation has one page and one read-only endpoint, so none of them has a user yet.

- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Unify full-site i18n URLs between `/ar/` and `/app/ar/`.
  evidence: `/ar/`, `/en/` and `/fr/` belong to Django, which is why the export is served under `/app/`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Add a Content-Security-Policy for pages under `/app/` before they reach production.
  evidence: Story 1.1 links `/app/` from the landing page. The project owner deferred this on 2026-11-06 as a release blocker because product work stays on local `development` until all epics are complete. `add_web_headers` sets frame and robots headers only, and the settings define no CSP. Sources: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`; `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Add browser-level tests for `/app/` routes, covering hydration, rendered states, RTL, no-retry, keyboard and reduced motion, before they reach production.
  evidence: Deferred by the project owner on 2026-11-06 as a release blocker. The tests have more to cover once Stories 1.2 and 1.3 add interview content. The foundation's automated tests cover the probe logic but not `SessionStatus` rendering; hydration was checked by hand in headless Chrome only. Sources: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`; `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`
  summary: Handle failed or stale JavaScript chunks on `/app/` routes with an interview fallback, including tabs left open across a deploy, before they reach production.
  evidence: The project owner deferred failed or stale JavaScript chunk handling on 2026-11-06 as a release blocker. The image holds only its own release's hashed assets; an interview fallback for failed chunks remains open. Partly shipped in `27215dc` and `3a0ab0d`: noscript covers disabled JavaScript and `web/src/app/[locale]/site-nav.tsx:56-71` provides language switching. Sources: `_bmad-output/implementation-artifacts/spec-1-1-zero-signup-case-start.md`; `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-start-interview-madhab-selection.md`
  summary: Make the locale test compare each pair of locales, so French copied from English fails.
  evidence: `new Set(texts).size >= 2` in `web/src/api/case.test.ts` passes whenever Arabic alone differs, and this check predates Story 1.2.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-deceased-info-add-heirs-via-guided-interview-form.md`
  summary: Extend the heir relationship list with the remaining maternal and paternal grandparent lines, lower generations, and the relatives Jafari and Hanafi distant-kindred rules need.
  evidence: `api/anonymous_case.py` lists 23 relationship IDs, including paternal and maternal grandmothers; `grandfather` represents the paternal grandfather. Missing are the maternal grandfather, more remote grandparent lines and lower generations, and the additional relatives needed by Jafari and Hanafi distant-kindred rules.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-family-tree-visualization-basic-render-updates.md`
  summary: Add node selection with arrow-key navigation, and pan or pinch zoom, to the family tree.
  evidence: Cut from Story 1.4, which draws a static tree inside a focusable scroll area with `role="img"`; the UX spec expects selectable nodes, and the list remains the way to edit and remove heirs.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-family-tree-visualization-basic-render-updates.md`
  summary: Build the full-viewport tree layout with the floating question card on desktop and the bottom sheet on tablet and mobile.
  evidence: Cut from Story 1.4, which keeps the tree, form and list stacked on the heir screen; the UX spec and epic context describe the immersive view.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-family-tree-visualization-basic-render-updates.md`
  summary: Add repeatable browser tests for the tree's rendering, reveal scrolling, RTL mirroring and keyboard path.
  evidence: The repo has no browser test tool, so these were checked once with a throwaway headless Edge script that is not in the repo, and a regression would pass lint, typecheck, unit tests and build.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-family-tree-visualization-basic-render-updates.md`
  summary: Decide how to keep the deceased visible once the tree outgrows its 45% viewport cap.
  evidence: In a headless browser, a six-heir family already overflowed the cap at 375px and 1280px, and revealing a new node on the last line scrolled the deceased out of view.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Show each heir's share on its tree node, with the fiqh citation and proof, in Story 2.2.
  evidence: Story 1.5 shows shares in a list under the form only, and the spec rules out shares on tree nodes, citations and proof.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Add browser tests (Playwright with axe) for the heir screen with the share preview: add, edit, remove, change school, a refused case, a failed request, RTL at 320px, dark mode, forced colors and a keyboard-only run.
  evidence: The suite has no browser runner yet. The staleness and display rules are covered by pure tests against the shared fixtures, and the component's effects, focus behavior and layout were not run in a browser.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Have a native reviewer check the preview's refusal sentences, especially the Malikiyya sentence, which in Arabic reads like a repeat of the school's name.
  evidence: All Arabic and French preview text is unreviewed, and these sentences explain to visitors why no number is given.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Check the relationship on blur in the edit form too, not only on save.
  evidence: `heir_options` describes adding to the whole family, and an edit leaves that heir out, so the edit form shows plain labels, runs no blur check, and only the server judges it on save.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Add browser tests (Playwright with axe) for the add form's labels on blocked relatives, the hint, the second-father and spouse errors, a changed gender with a saved spouse, Arabic at 320px, and a keyboard-only run.
  evidence: The labels, hint and error display were covered by pure tests and a built export only; no browser runner exists yet.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Have a native Arabic and French speaker and a fiqh reviewer check the new text: the kinship messages, the "does not inherit with the family so far" label and the hint under the relationship list.
  evidence: All new Arabic and French text is unreviewed, and the label states a fiqh result (hajb) to the visitor.

## Product scope / future epics

- source_spec: none
  summary: Results lifecycle covering draft or certified reporting, save or share flows, and privacy controls.
  evidence: Split from the broader Mawareeth V3 intent because reporting and privacy features can be reviewed and shipped independently of infrastructure migration.

- source_spec: none
  summary: Lawyer operations covering onboarding, approval, pricing, sponsorship, marketplace purchase, and certification audit.
  evidence: Split from the broader Mawareeth V3 intent because the marketplace and certification workflow form a separate commercial and operational slice.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-deterministic-proof-output-for-multi-school-results.md`
  summary: Show the proof on the results and preview screens (Epic 3).
  evidence: The preview API now returns `proof` with labels in the request language, but nothing in the web app displays it.
