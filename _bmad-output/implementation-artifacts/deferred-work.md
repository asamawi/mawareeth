# Deferred Work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7c-relatives-linked-into-a-later-death.md`
  summary: Qualified review of the automatic relatives derivation table and ambiguity questions.
  evidence: Review all 23 lineage paths, full and half siblings, unnamed parents, multiple wives and female deceased cases in `api/kinship.py` before production reliance; Arabic and French wording also needs native review.

This backlog records work that remains open, grouped by area.
Entries use `- source_spec: <path in backticks> | none`, followed by one-line `summary:` and `evidence:` fields and an optional `resolved_by:` field.
Completed and obsolete items are removed; their history is in git.

## Deploy & host

- source_spec: `_bmad-output/implementation-artifacts/spec-0-4-create-secured-hetzner-host-baseline.md`
  summary: Document the admin user's passwordless sudo grant and the first-connection TOFU host-key acceptance (`StrictHostKeyChecking=accept-new`) as deliberate tradeoffs, and add a break-glass recovery procedure for an SSH lockout.
  evidence: Both are real, currently-undocumented security-relevant decisions in `bootstrap-host.sh`/`provision-host.sh`; `deploy/README.md` only warns "do not remove the only permitted CIDR" with no recovery path if it happens anyway.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-bootstrap-sandboxed-guest-validation-run.md`
  summary: Execute `bootstrap-host.sh`'s later public-web steps (`require_ufw_ipv6`, `converge_docker_web_rules`, `allow_public_web`, `persist_web_sources`) through the entry point, not only by call-line checks.
  evidence: The sandboxed run in `test_host_baseline.sh` stops at the first host change (`apt-get update`), so these steps are still proven only by `grep -cx` call checks and extracted-helper runs; reaching them needs stand-ins for the shell redirections into `/etc` that PATH stubs cannot intercept.

- source_spec: `_bmad-output/implementation-artifacts/spec-0-2-make-django-production-ready.md`
  summary: Deploy-check the real runtime configuration (e.g. `DJANGO_KEY` strength, `security.W009`), not just build placeholders.
  evidence: Image build and CI both run `check --deploy` with placeholder values; the runtime only enforces presence. Pre-existing.

- source_spec: `_bmad-output/implementation-artifacts/spec-0-5-build-the-private-compose-runtime.md`
  summary: Add an operator-approved retention and cleanup workflow for superseded content-addressed runtime snapshots after secret rotation.
  evidence: Snapshot lifecycle is a distinct operational policy requiring rollback-retention decisions; Story 0-5 safely creates immutable snapshots but does not delete prior secret material automatically.

- source_spec: `_bmad-output/implementation-artifacts/spec-0-6-implement-safe-blue-green-deployment.md`
  summary: Extend the supported runtime-configuration rotation to adopt the new snapshot in both slots with overlap for compatibility-affecting keys.
  evidence: Both-slot adoption of the new snapshot with overlap for compatibility-affecting keys remains unsupported. Partly shipped in `0a35899`: `release.sh deploy --rotate-config` and the README procedure rotate the candidate while the prior slot retains its old configuration.

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

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-collector-failure-alerts.md`
  summary: Prove at runtime that Alertmanager suppresses host alerts (including the new `MawareethHostMetricsMissing`, whose absent() branches fire during a scrape outage) while `MawareethHostDown` fires for the same project.
  evidence: `deploy/tests/test_monitor.sh` checks receiver selection with `amtool` and the inhibit matchers as text only; no harness evaluates inhibition. Settle with a throwaway Alertmanager that receives both alerts and lists `/api/v2/alerts?inhibited=false`, or rely on the quarterly alert-path drill.

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

## CI

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

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-content-security-policy.md`
  summary: Exercise Facebook and LinkedIn social login live on the deployed stack under the new CSP `form-action`.
  evidence: The export CSP allows `form-action 'self' https://www.facebook.com https://www.linkedin.com` because `/social-auth/login/…` redirects to those origins and Chrome applies `form-action` to redirects. Not testable locally; confirm both providers complete sign-in.

## Django / API

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-successive-deaths-manasikhat-in-the-interview.md`
  summary: Arrange qualified fiqh review of layered previews built from interview input.
  evidence: Story 1.7a adds linked identities, inferred death order and combined shares across layers; these interview-built previews need qualified review across the supported schools.

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
  summary: Count production `Calculation` rows with `user=None` and decide what happens to them, since the app now answers 404 for them and only Django admin reaches them.
  evidence: The count was not checked before the change, so the number of affected cases is unknown.


- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-case-write-integrity.md`
  summary: Decide whether to bound the case write lock wait (for example `SET LOCAL lock_timeout` with a clear "another change is in progress" response) and add a metric or log for lock wait time, before the interview opens widely.
  evidence: `CaseWriteLockMiddleware` waits with no timeout, so one visitor firing many parallel writes, or a hung request inside the lock, ties up workers and DB connections until gunicorn's timeout; the spec put any lock timeout under Ask First, and review flagged the lack of visibility.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-compute-transaction.md`
  summary: Decide whether to bound the `compute()` row-lock wait (for example `SET LOCAL lock_timeout`) on the results pages, which run it on every GET.
  evidence: Overlapping results-page views of one case now wait on `select_for_update()` with no limit, so a slow or stuck run ties up web workers; the spec put any lock timeout under Ask First.

## Calculation engine & proof

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

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-announce-edit-sheet-relationship-errors.md`
  summary: Check with real screen readers (NVDA, JAWS, VoiceOver, TalkBack) that the tree edit sheet's relationship alert is spoken on a refused or rejected pick, and again on an identical retry.
  evidence: The alert (`role="alert"` on `#heir-relationship-error`, inner span re-keyed per refusal) is tested in jsdom only; whether each screen reader speaks a replaced span with identical text is unverified.

- source_spec: none
  summary: Have a native Arabic and French speaker review the new "Cancel" label added to calc/templates/calc/calculation_confirm_delete.html — AR msgstr is empty.
  evidence: Added as msgid "Cancel" with msgstr "" in locale/ar and locale/fr as part of the case-delete confirmation story; EN is self-translating.

- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-drf-foundation.md`
  summary: Add shadcn/ui, React Query, Zustand and drf-spectacular with the first story that uses each.
  evidence: The foundation has one page and one read-only endpoint, so none of them has a user yet.

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
  evidence: The repo has no browser test tool, so these were checked once with a throwaway headless Edge script that is not in the repo, and a regression would pass lint, typecheck, unit tests and build. Addressed by Story 9.11: Playwright now covers the tree's geometry, reflow, RTL mirroring and reduced motion in en and ar.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-family-tree-visualization-basic-render-updates.md`
  summary: Decide how to keep the deceased visible once the tree outgrows its 45% viewport cap.
  evidence: In a headless browser, a six-heir family already overflowed the cap at 375px and 1280px, and revealing a new node on the last line scrolled the deceased out of view.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Show each heir's share on its tree node, with the fiqh citation and proof, in Story 2.2.
  evidence: Story 1.5 shows shares in a list under the form only, and the spec rules out shares on tree nodes, citations and proof.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Add browser tests (Playwright with axe) for the heir screen with the share preview: add, edit, remove, change school, a refused case, a failed request, RTL at 320px, dark mode, forced colors and a keyboard-only run.
  evidence: The suite has no browser runner yet. The staleness and display rules are covered by pure tests against the shared fixtures, and the component's effects, focus behavior and layout were not run in a browser. Addressed by Story 9.11 for RTL at 320px with text spacing and dark mode (axe and geometry); forced colors stay unproven.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-real-time-share-preview-from-supported-engine-cases.md`
  summary: Have a native reviewer check the preview's refusal sentences, especially the Malikiyya sentence, which in Arabic reads like a repeat of the school's name.
  evidence: All Arabic and French preview text is unreviewed, and these sentences explain to visitors why no number is given.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Add browser tests (Playwright with axe) for the add form's labels on blocked relatives, the hint, the second-father and spouse errors, a changed gender with a saved spouse, Arabic at 320px, and a keyboard-only run.
  evidence: The labels, hint and error display were covered by pure tests and a built export only; no browser runner exists yet. Addressed by Story 9.11 for Arabic at 320px (reflow and axe with text spacing); the other clauses are covered by the earlier Interview specs.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-fiqh-aware-validation-hajb-blocking-heirs.md`
  summary: Have a native Arabic and French speaker and a fiqh reviewer check the new text: the kinship messages, the "does not inherit with the family so far" label and the hint under the relationship list.
  evidence: All new Arabic and French text is unreviewed, and the label states a fiqh result (hajb) to the visitor.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-full-recursive-manasikhat-calculation.md`
  summary: Have qualified reviewers check the manasikhat matrix and the Arabic and French refusal text.
  evidence: Automated tests cover the matrix; qualified fiqh and native-language review remains outstanding.

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


- source_spec: none
  summary: Move the anonymous interview case out of the database-backed Django session into browser storage, so no case data reaches the server's database before an explicit save.
  evidence: Raised by the project owner on 2026-11-10 while planning Story 1.7; the session storage of Stories 1.1-1.6 is kept for 1.7.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-successive-deaths-manasikhat-in-the-interview.md`
  summary: Story 1.7b, the web interview for successive deaths: strict parsing of `deaths`, the new writes and `proof: null`; the active layer, the mark/unmark and order-of-death question, and the "someone already in this case" link choice in the flow; a breadcrumb of deaths, the tree drawing one layer at a time with its deceased labelled by death order, the list actions "also died" / "open their heirs" / "did not die", people named by their earliest row in the preview; all text in ar/en/fr; and the TypeScript side of the layered preview fixtures.
  evidence: Split from Story 1.7 on 2026-11-10 to keep the spec within size; 1.7a delivers the session layers, writes, preview and contracts that this builds on.

- source_spec: none
  summary: Story 3.1b, the layered (successive-death) proof on the results page: carry the engine's v2 layered proof through the preview API with session ids and labels, add it to the contract, fixtures and the web parser, and show each layer's explanation on the results page.
  evidence: Split from Story 3.1 on 2026-11-10 at the project owner's choice; 3.1 delivers the results page with the single-death proof, kirat and citations and states that layered explanations are not available yet.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1b-scholars-inheritance-table.md`
  summary: Story 3.1c, successive deaths in the scholars' table: carry the engine's v2 layered proof through the preview API (session ids, labels, no engine pks; layer `heir` from the session death by order) with contract, fixtures and strict parser, and show the classic side-by-side manasikhat table (each later death's problem beside the earlier ones with the deceased's shares, the multiplier and the running jami'a, checked on the server against the engine's final fractions) on the results page and the interview preview, with each layer's explanation as row side notes.
  evidence: Split from Story 3.1b on 2026-11-10 at the project owner's choice; 3.1b delivers the scholars' table for single-death cases, which 3.1c extends.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-save-draft-report-to-registered-account.md`
  summary: FR-19 anonymization is not implemented; names and estate are stored as entered.
  evidence: SavedCase stores the explicit input snapshot. Anonymization remains deferred by Story 4.2.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-share-report-with-registered-users-or-email-invitees.md`
  summary: Request native review of the new Arabic, English and French invitation UI and email text.
  evidence: Review invitation, sign-in and expiry wording, including Arabic RTL readability.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-5-whatsapp-share-for-registered-users.md`
  summary: Request native review of the new Arabic, English and French WhatsApp share strings.
  evidence: Review the WhatsApp button, ready status, "Open WhatsApp" label and unavailable-fallback wording, including Arabic RTL readability.

- source_spec: `_bmad-output/implementation-artifacts/spec-legacy-calculations-in-saved-cases.md`
  summary: Done 2026-11-18 21:06 UTC: the production purge deleted the 1,145 empty legacy drafts `api.0004` did not convert (`deleted=1145`); kept as the Story 8.12 record.
  evidence: Release 02d3627 ran the import on 2026-11-13: converted=2053, reported=1146, ownerless=0, owners affected 965 (841 no deceased, 304 no heirs, and calculation 2402 of owner 1829 with more than one deceased). The production dry run of 2026-11-18 found `no_deceased=841 no_heirs=304 total=1145`, matching the report; `purge_empty_legacy_drafts --expect 1145` (Story 8.12) deletes them. Calculation 2402 is not empty (a mother and three daughters) and the command never selects it. Its extra, unlinked deceased row 11034 was deleted on 2026-11-19 by owner decision, keeping 11033, which the family is attached to; the row is kept root-only in `deploy/runtime/backup/calc-2402-deceased-11034-20261119.txt`, and 2402 now converts. On 2026-11-19 it was converted, like the `api.0004` import does, into Saved case 2055 for owner 1829 (schema 1, default name); the legacy row stays, as for every converted calculation. The purge ran per `deploy/README.md`, "Legacy draft purge": a fresh restic backup (`result=ok`, 21:04 UTC), the cross-tree check (1,145 roots, no later-death layers, 304 people, 2 marriages, zero references from outside), then `--expect 1145` (`deleted=1145`). A dry rerun finds `total=0`; 2,054 root calculations remain (the 2,053 converted plus 2402), and Saved cases were not touched. The full import report is in the host's root-only `deploy/runtime/logs/migrate-20261113T224032Z-3125246.log`.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-add-heir-picker.md`
  summary: Request native review of the two new add-heir picker strings in Arabic, English and French: "More relatives" (button) and "Other relationship" (select label).
  evidence: ar "أقارب آخرون" / "صلة قرابة أخرى"; en "More relatives" / "Other relationship"; fr "Autres proches" / "Autre lien de parenté". Check wording and the Arabic RTL layout of the picker.

- source_spec: none
  summary: Retire the remaining legacy Django HTML pages (calc form, detail, results, delete confirmations, profile, error) by redirecting each to its Next.js equivalent and deleting the templates and views.
  evidence: Split on 2026-11-13 from the "move all Django HTML to Next.js" intent at the project owner's choice (order 6 of 6); must follow the legacy-calculation migration. The old Django home, about, terms and privacy pages are already gone (replaced by the Next.js pages at the site root). Owner decision 2026-11-13: old calculation URLs are not displayed any more; they are retired with the Django pages and not redirected to the migrated saved case (migrated cases are reached from My saved cases).

- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-auth-pages.md`
  summary: Harden auth abuse controls beyond the per-IP `auth` quota: per-account login attempt limits (and current-password attempts on `auth/password-change/`), a per-recipient password-reset email cooldown, and sending reset email off the request path so response timing cannot reveal whether an account exists.
  evidence: Review of the Next.js auth pages found that distributed clients can still target one account or one inbox, and the reset response time differs for existing accounts. The old Django views had the same exposure and no throttle at all.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-password-change-page.md`
  summary: Request native Arabic, English and French review of the new password-change strings (`auth.change`, `auth.old_password`, `auth.noPassword` in `web/src/i18n/messages.ts`).
  evidence: Review the change-password title, current-password label and social-only account explanation, including Arabic RTL readability.

- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-site-root-landing-seo.md`
  summary: Request native Arabic, English and French review, and fiqh review for the Arabic and French fiqh terms, of all new landing, about and FAQ text (`landing`, `about`, `faq`, `footer` and the metadata descriptions in `web/src/i18n/messages.ts`).
  evidence: The text was drafted by the model, not translated from reviewed sources. It states only what the product does today (four Sunni schools, successive deaths, proof with citations, draft PDF, save and share) and that results are not a fatwa. The English first about paragraph fixes the grammar of the old "is was first launched" sentence; the Arabic and French about history paragraphs are the existing `.po` translations of the old wording. Revised 2026-11-13 (model-drafted, in `web/src/i18n/public-pages.ts`): the "Compare the schools" step, the schools coverage card, the FAQ answer on schools and the about limits now describe "one result when the four agree, a choice when they differ", and no longer say that the Jafari school is unsupported. Revised again 2026-11-14: the about history's "Mawareeth 2.0 is the latest release" line is replaced by a model-drafted sentence on what Mawareeth does today, and the "What Mawareeth does today" list was redrafted.

- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-site-root-landing-seo.md`
  summary: Review the ported terms and privacy text (`terms` and `privacy` in `web/src/i18n/messages.ts`) and the drafted `metaDescription` for each, in all three languages.
  evidence: No `.po` msgstr for these pages was empty, so ar and fr are the existing translations copied verbatim. English is the msgid verbatim, including its typos (for example "webste"). Only the two short meta descriptions are new drafts.

- source_spec: `_bmad-output/implementation-artifacts/spec-nextjs-site-root-landing-seo.md`
  summary: Update the terms and privacy text for accounts, sharing and email delivery.
  evidence: The ported wording predates registration, saved cases, share links, email invitations and WhatsApp sharing, and still describes advertising partners; the owner kept the meaning unchanged for this move.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-stale-chunk-fallback.md`
  summary: Native Arabic and French review of the new `pageError` text (`title`, `body`, `reload`, `interview`) in `web/src/i18n/messages.ts`, shown by the error fallback when a page or script chunk fails to load.
  evidence: The Arabic and French wording was drafted without native review; the English is the source text ("This page did not load correctly", "Reload the page to continue. Your saved answers are kept.", "Reload page", "Back to the interview").

- source_spec: `_bmad-output/implementation-artifacts/spec-school-only-when-it-matters.md`
  summary: Request native Arabic, English and French review, and fiqh review for the Arabic and French wording, of the new school-of-law text: `schoolsAgree`, `schoolsDiffer`, `schoolsDifferBecause`, `chooseSchool` (interview) and `saveNeedsSchool` (results) in `web/src/i18n/messages.ts`, and the new msgid "Same result in all four Sunni schools" in `locale/{ar,fr,en}/LC_MESSAGES/django.po` (draft PDF School line).
  evidence: The strings were given by the owner in the spec, not drafted from reviewed sources. The Arabic reads "النتيجة نفسها في المذاهب السنية الأربعة" (with "السنية", matching en and fr; the spec text omitted it). Check "the same result in the four Sunni schools" is stated precisely enough in fiqh terms, and the compiled `.mo` files were regenerated with polib because `msgfmt` is not installed on the development host.

- source_spec: `_bmad-output/implementation-artifacts/spec-school-only-when-it-matters.md`
  summary: A case with no school costs four engine runs per preview request (and per save, shared view and draft PDF of such a case), because the preview compares the four Sunni schools. This extends the "move the preview off database writes" item above.
  evidence: Each run builds and rolls back its own rows inside a transaction. A school-set case still costs one run. Moving the engine to an in-memory path, or caching the comparison by the case's basis, would remove the multiplier.

## Terms and Locale settings (Story 8.5)

- source_spec: `_bmad-output/implementation-artifacts/spec-8-5-keep-terms-and-locale-settings-consistent-across-consumers.md`
  summary: Native review of the new `basis.*` terms (all three Locales, `review: pending`).
  evidence: Drafted new, no earlier text existed. en: compare "Compare the four Sunni schools", school "One school", country "Country law"; ar: compare "مقارنة المذاهب السنية الأربعة", school "مذهب واحد", country "قانون البلد"; fr: compare "Comparer les quatre écoles sunnites", school "Une seule école", country "Droit du pays".

- source_spec: `_bmad-output/implementation-artifacts/spec-8-5-keep-terms-and-locale-settings-consistent-across-consumers.md`
  summary: Native review of the two empty `Cancel` msgstrs that were filled in `locale/{ar,fr}/LC_MESSAGES/django.po`.
  evidence: ar "إلغاء", fr "Annuler" (en was already "Cancel").

- source_spec: `_bmad-output/implementation-artifacts/spec-8-5-keep-terms-and-locale-settings-consistent-across-consumers.md`
  summary: Native and fiqh review of every server or PDF string that converged onto the web wording in `i18n/terms/<locale>.json` (all `review: pending`). Before is the old gettext text, after is the catalog text. Relationship names and the other school names already matched.
  evidence: ar `refusal.school_not_supported`: "هذا المذهب غير مدعوم حتى الآن" -> "المذهب الجعفري غير مدعوم بعد، فلا تُعرض أنصبة." | ar `refusal.malikiyya_disputed`: "مسألة المالكية مختلف فيها داخل المذهب المالكي، لذلك لا تُعطى نتيجة" -> "اختلف علماء المذهب المالكي في هذه الحالة (المالكية)، فلا تُعرض أنصبة." | ar `refusal.manasikhat_unsupported`: "حالة المناسخات هذه غير مدعومة" -> "معاينة الوفيات المتعاقبة غير مدعومة لهذه الحالة. يرجى مراجعة البيانات وطلب مراجعة من مختص في المواريث." | en `refusal.school_not_supported`: "This school of law is not supported yet" -> "The Jafari school is not supported yet, so no shares are shown." | en `refusal.malikiyya_disputed`: "The Malikiyya case is disputed within the Maliki school, so no result is given" -> "Scholars of the Maliki school disagree about this family (the Malikiyya case), so no shares are shown." | en `refusal.manasikhat_unsupported`: "This successive inheritance case is not supported" -> "A preview for successive deaths is not supported for this case. Check the details and seek a qualified inheritance review." | en `school.shafii`: "Shafii" -> "Shafi'i" | fr `refusal.school_not_supported`: "Cette école juridique n'est pas encore prise en charge" -> "L'école jafarite n'est pas encore prise en charge, aucune part n'est donc affichée." | fr `refusal.malikiyya_disputed`: "Le cas de la Malikiyya est controversé au sein de l'école malikite, donc aucun résultat n'est donné" -> "Les savants de l'école malikite divergent sur cette famille (le cas de la Malikiyya), aucune part n'est donc affichée." | fr `refusal.manasikhat_unsupported`: "Ce cas de successions successives n'est pas pris en charge" -> "L'aperçu des décès successifs n'est pas pris en charge pour ce cas. Vérifiez les informations et demandez un examen par une personne qualifiée en successions." | fr `school.maliki`: "Malékite" -> "Malikite" | fr `school.jafari`: "Jafarite" -> "Jaafarite".

- source_spec: `_bmad-output/implementation-artifacts/spec-8-5-keep-terms-and-locale-settings-consistent-across-consumers.md`
  summary: Fiqh copy still outside the catalog, left for Stories 8.6/8.7 and Epic 12: general UI copy in `messages.ts`, the legacy calc template heir-class msgids (`Mother`, `GrandFather`, ...), report `COMBINATION_RELATIONS`, and the results/table fiqh copy in `messages.ts` and `.po`.
  evidence: These are not code-keyed in `engine/contracts/codes.py`, so the catalog has no key for them yet. `SAME_IN_ALL_SCHOOLS` stays a gettext msgid.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-5-keep-terms-and-locale-settings-consistent-across-consumers.md`
  summary: The Locale `review` state for ar, en and fr in `i18n/locales.json` stays `pending` until Epic 12/18 decides how a Locale becomes reviewed.
  evidence: Nothing in this story marks any Locale or term reviewed. `numbering_system` is `latn` for all three, matching today's Latin digits in the PDF.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-5-keep-terms-and-locale-settings-consistent-across-consumers.md`
  summary: Confirm the PDF glyph check (`python -m i18n.glyphs`) passes on CI with `fonts-noto-core`.
  evidence: The development host has no Noto fonts, so the check was only run locally to the "family not installed" failure (exit 1) and by unit tests with fake cmaps.

## One presented answer (Story 8.6)

- source_spec: `_bmad-output/implementation-artifacts/spec-8-6-produce-one-presented-answer-for-every-renderer.md`
  summary: Native and fiqh review of the two new catalog keys (all three Locales, `review: pending`). Copied byte for byte from `messages.ts`; nothing was reworded.
  evidence: `notice.disclaimer` = `footer.note` (en "Mawareeth is a calculation aid, not a fatwa or legal advice."; ar "مواريث أداة مساعدة على الحساب وليست فتوى ولا استشارة قانونية."; fr "Mawareeth est une aide au calcul, pas une fatwa ni un conseil juridique."). `comparison.same_in_all_schools` = the `schoolsAgree` key (en "Same result in all four Sunni schools"; ar "النتيجة نفسها في المذاهب السنية الأربعة"; fr "Même résultat dans les quatre écoles sunnites").

- source_spec: `_bmad-output/implementation-artifacts/spec-8-6-produce-one-presented-answer-for-every-renderer.md`
  summary: The new `default_currency` field of the Locale registry (`i18n/locales.json`, required by the validator) needs an owner re-check when a Locale is added.
  evidence: ar SAR, en USD, fr EUR (owner decision 2026-11-16). `presentation.default_currency(locale, preset=None)` returns the preset's currency when a preset is given; no caller passes one until the Country extension.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-6-produce-one-presented-answer-for-every-renderer.md`
  summary: Notice slots with no copy yet: `country_notice`, `citation`, `civil_law`, `obligatory_bequest_prompt` (FR-14) and `locale_beta`. They are selected by `presentation.select_notices` but disabled in `ENABLED_NOTICES`, which holds only `disclaimer`.
  evidence: Copy and enabling belong to Epics 9-12. The predicates are tested with an `enabled` override so they are ready.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-6-produce-one-presented-answer-for-every-renderer.md`
  summary: Display changes the consumers will show once they render PresentedResult strings (AD-19). The full labelled table is `presentation/tests/fixtures/display-changes.json`.
  evidence: Amounts gain a currency in Babel's form (en "$125.00", fr "125,00 €", ar "‏125.00 ر.س.‏" with CLDR's own right-to-left marks around it) where preview showed a bare "125.00". fr percent gains the CLDR no-break space ("12,5 %", was "12.5%" in the PDF). Percent and kirat keep the PDF's half-up rounding. The Arabic amount text contains U+200F from CLDR itself; presentation injects no control characters. A family with no heirs yet raises `PresentationError("no_heirs")`: the legacy preview is "not ready" there. A person is `blocked` only with a zero final share (`presentation/compare.py` `answers`), as the legacy layered preview flagged it, so someone blocked in the first estate who inherits from a later death is not shown as blocked.

## Existing consumers switched after full parity (Story 8.7)

- source_spec: `_bmad-output/implementation-artifacts/spec-8-7-switch-existing-calculation-consumers-only-after-full-parity.md`
  summary: Native and fiqh review of the seven new column catalog keys (all three Locales, `review: pending`). Copied byte for byte from the existing `.po` msgstr of the legacy table captions; nothing was reworded.
  evidence: `table.column.base` = "Shares", `awl` = "Excess", `radd` = "Shortage", `remainder` = "Remainder", `radd_calc` = "Shortage calc", `radd_union` = "Calc Union", `correction` = "Correction" (ar "السهام", "العول", "الرد", "الباقي تعصيبًا", "مسالة الرد", "الجامعة", "التصحيح"; fr "Parts", "Excès", "Pénurie", "Reste", "Pénurie calc", "Calc Union", "Correction"). The legacy gettext captions in `api/preview._column_labels` stay for the legacy `table` field until it is removed.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-7-switch-existing-calculation-consumers-only-after-full-parity.md`
  summary: The legacy Django results pages (`ResultsView`, `NewResultsView`) now look the way PresentedResult draws them: one table of presented rows (name, quote, percentage, relationship with its Arabic original, amount), an unallocated row and the scholars' table, instead of the per-class ORM column layout with its rowspan and JS cell merging. Product and visual review needed; Epic 12 decides whether the pages are retired.
  evidence: `calc/templates/calc/_presented_result.html` is shared by both pages. Later deaths are still refused on these pages (the existing `manasikhat_unsupported` page). The pages render `percentage` and `blocked` with the existing msgids; `Unallocated remainder` is reused for the unallocated row.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-7-switch-existing-calculation-consumers-only-after-full-parity.md`
  summary: Still awaiting removal: `Calculation.legacy_compute` and `calc.manasikhat.compute_manasikhat` (parity reference only, Epic 12), the ORM derived columns, the legacy preview fields (`shares`, `unallocated`, `proof`, `table`, `schools`, `rules` beside `presented`; next release, once no cached bundle needs them), and the test-only `calc/legacy_preview_reference.py`.
  evidence: No production path calls `legacy_compute` or the reference preview. `legacy_compute` still takes an unbounded `select_for_update` (it is no longer reachable from a request). `calc/test_switch_gate.py` compares the switched consumers with all of them.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-7-switch-existing-calculation-consumers-only-after-full-parity.md`
  summary: Amounts now carry a currency symbol everywhere they are rendered from `presented` (the legacy session estate is SAR explicit): en "SAR1,000.00", ar "‏1,000.00 ر.س.‏". The PDF, the web and the legacy pages show it; the legacy preview `amount` field is unchanged ("1000.00").
  evidence: Owner decision 2026-11-16 for phase-1 bare decimals. The PDF "Estate" line and the web `formatEstate` still echo the typed estate.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-7-switch-existing-calculation-consumers-only-after-full-parity.md`
  summary: `formatEstate` in `web/src/interview/answers.ts` formats the visitor's typed estate (an input, not a result) with `Intl` and is left as it is.
  evidence: The acceptance grep for `Intl.NumberFormat` is over the result renderers; `answers.ts` is the only remaining use.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-7-switch-existing-calculation-consumers-only-after-full-parity.md`
  summary: Small display differences of the switch for review: the web shows the unallocated share with its amount only (the percent beside it is not in PresentedResult); the "Death n" caption, the table's `span`, `group_span` and `order` stay plain integers (structural, not formatted leaves); the PDF's new Rounding line uses the untranslated msgid `Rounding` in ar and fr until a translator adds it (no gettext tools on the development host); a blocked heir's empty scholars'-table cell is empty in the PDF, where it printed "None".
  evidence: v3 formats every numeric leaf of the table (`{value, text, dir}`) except those structural counts. The web proof panels take a fixed share's fraction from the table's own prescribed text. The step values on the Full results page are the table's column totals (`radd` reads the union column when there is one).

- source_spec: `_bmad-output/implementation-artifacts/spec-8-7-switch-existing-calculation-consumers-only-after-full-parity.md`
  summary: A preview or results response from this release carries `presented` (v3). A web bundle from the release before parses the body without it; a bundle from this release treats an answer without a valid `presented` as a failed preview. `invalid_family` was added to `UnsupportedCase.message` so a core refusal of an impossible family has a sentence on the legacy pages.
  evidence: The additive field is why the legacy fields stay for one release. A spouse of the deceased's own sex alone is still refused by the preview's consumer guard (the Family holds no gender for its root), through `presentation.refused_outcome`.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-7-switch-existing-calculation-consumers-only-after-full-parity.md`
  summary: Two new gettext msgids have no ar or fr translation yet and show in English there. One is "The case is busy. Try again.", the retryable 503 body of a legacy write whose case lock wait passes 500 ms. The other is "Rounding", the PDF rounding line. Both need native translation and review.
  evidence: Neither msgid is in `locale/{ar,fr}/LC_MESSAGES/django.po`. The other captions the legacy pages use already have translations: Name, Quote, Percentage, Relation, Amount, Unallocated remainder and blocked.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-7-switch-existing-calculation-consumers-only-after-full-parity.md`
  summary: The copied column captions need a terminology review before they leave `pending`.
  evidence: The ar `table.column.radd_calc` "مسالة الرد" is missing its hamza ("مسألة"). en "Excess"/"Shortage" for awl/radd are not the usual fiqh terms. fr "Pénurie" for radd and the English "Calc Union" / "Shortage calc" in fr need a translator. These are the legacy `.po` texts, copied unchanged per the no-rewording rule.

## Story 8.8 follow-ups

- The 8.10 writer switch must append its release image to `api/fixtures/snapshots/matrix.json`.
- The schema 2 encoder raises above 2^53 minor units.
- Alias row ids are regenerated when reading schema 2; person ids remain stable.
- Unreadable rows are hidden from My cases rather than shown with an error.
- The web displays typed snapshot errors as its generic failure.

## Story 8.9 follow-ups

- The new offline message (`offlineEditing`, ar and fr) needs native review.
- Removals and un-marking a death send `confirm_cascade: true` until the Epic 9 impact dialog exists.
- The currency, eligibility-answer, tree-drop and redeem commands plug into `api/case_commands.py` later.
- The limit stays 50 Heirs per layer (AD-26 says 50 Heirs).
- A web bundle opened across the deploy gets 400 `invalid_revision` on writes until it reloads.
- The case lock measurements are `mawareeth.case_lock` log records, not metrics yet.
- Resolved: a same-Case revision conflict now refreshes the Interview in place for the deceased form, the legacy heir form, mark and unmark death and the school choice (as it already did for the panel, bulk, tree adds, sheet edit/delete and Undo). The screen, the open form and the visitor's school pick stay, the live Case is adopted and the conflict alert shows. A conflict with a different case id still shows the existing-case screen.
- The edit sheet's unsent draft is still dropped on a same-Case conflict. It saves on blur, so keeping a stale value could resend it and overwrite the other tab's change. Keeping it needs an explicit-retry design.
- A live guest session created before this release has no `changed_at`, so its expiry runs from `started_at`. A guest who started more than 24 hours ago and is still editing at deploy time sees the Case expire once.
- The 503 `busy` response is shown as the generic failed notice. The web does not retry using `Retry-After`.

## Story 8.10

- Ops order: take a fresh restic backup, then flip `SNAPSHOT_WRITE_VERSION=2` and run the backfill only once every rollback-eligible image reads schema 2. Do not switch in the deploy that first ships 8.8.
- **Switch the writer to schema 2 once Epic 9 is merged to master and deployed** (owner decision 2026-11-19). The live image (`8b5d91b`, deployed 2026-11-18) already reads schema 2, but production cannot set the key until a release carries the `deploy/runtime.sh` allow-list entry for `SNAPSHOT_WRITE_VERSION` (on `development` since 2026-11-19), so the switch waits for the Epic 9 release. On the host, after that deploy: copy `/etc/mawareeth/runtime.env` to a root-only file, add `SNAPSHOT_WRITE_VERSION=2`, run `deploy/runtime.sh prepare`, then `deploy/release.sh deploy --rotate-config` (its `release_check --rollback-reads` must pass), confirm a new save is stored with `schema_version=2`, then take a fresh restic backup and run `backfill_saved_cases` (dry run first). Procedure: `deploy/README.md`, "Rotating runtime configuration" and the `SNAPSHOT_WRITE_VERSION` optional key.
- The new name msgids need native review.
- Backfill names use the site default Locale, not each user's.
- Legacy `Calculation.name` is not carried into names.
- Alias row ids are regenerated in v2.
- Save-conflict UX belongs to Epic 9.

## Story 8.11

- Foundation counts are log-based; Prometheus export and alert rules remain deferred.
- Network/render constants stand in for Story 9.12's real-device measurements.
- Production capacity evidence comes from the first deploy log.
- A production-backup restore rehearsal remains an operator step.

## Epic 8 retrospective follow-ups

Items the Epic 8 stories deferred only in their own spec, collected by `_bmad-output/implementation-artifacts/epic-8-retro-2026-11-18.md` (findings F13, F16, F17).

- source_spec: `_bmad-output/implementation-artifacts/spec-8-2-reproduce-existing-single-estate-school-answers-in-memory.md`
  summary: The engine cannot refuse a spouse of the deceased's own sex (a husband alone for a male deceased), because Family v1 has no gender for the root.
  evidence: `engine/core.py` `is_impossible` is gender-free; `calc/test_engine_parity.py` pins that the engine calculates these. Production is protected by the preview's consumer guard (`presentation.refused_outcome`), not by the core. Settle with a Family version carrying the root's gender.

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-engine-refuses-uncomputed-family-content.md`
  summary: The bequest, gift and eligibility stories must replace the `invalid_family` refusal of a Family carrying gifts, bequests or answers with real computation, or with a dedicated refusal reason with reviewed text and a Result/Comparison/PresentedResult version bump, before any producer emits these fields.
  evidence: `engine/core.py` `evaluate` now refuses them as `invalid_family`, whose text tells the user the family is impossible. No producer reaches it today (adapters send empty lists; snapshots reject the fields as `unsupported_content`).

- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-engine-refuses-gender-contradicting-relationship.md`
  summary: Count production legacy successive-death Calculations where a heir row's stored `sex` contradicts its class and that heir later dies with a spouse heir, since their result changed when the legacy adapter began taking gender from the class.
  evidence: The engine now refuses any gender-contradicting person (`invalid_family`) and `calc/adapters.py` takes legacy heir gender from the row class. A stored female `Son` linked to a female `Deceased` with a `Husband` heir used to calculate and is now refused; with a `Wife` heir it used to be refused and now calculates. Run a read-only production query joining `Heir` (class vs `sex`) to `Deceased.heir` and the later layer's spouse rows; none is expected.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-4-give-every-family-action-one-engine-decision.md`
  summary: Blocked labels and the answer disagree when the full sisters' cap exhausts the paternal siblings' pool beside a grandfather. The add-relative label says "not blocked" while the share is zero.
  evidence: `engine/kinship.py` keeps the wave-1 label; `engine/single.py` gives the paternal sibling `excluded_by_full_siblings` and share 0. `engine/tests/test_queries.py` `test_solver_consistency` pins the exception. Needs a fiqh/UX decision on labelling that case.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-6-produce-one-presented-answer-for-every-renderer.md`
  summary: A persisted currency that is not explicit is re-defaulted from the viewer's Locale at presentation time, so two viewers can see different currencies for one Case.
  evidence: `presentation/present.py` uses `default_currency(fmt.locale)` unless `currency.explicit`. Unreachable today (phase-1 estates convert to SAR explicit); settle before the currency picker writes non-explicit currencies.

- source_spec: none
  summary: Country writes must wait until every rollback-eligible image reads schema 2.
  evidence: Declared in `epic-8-context.md` (Cross-Story Dependencies) and carried by no story. Today Country Basis resolution is unavailable and `api/snapshots.py` rejects Country bases, so nothing writes them yet. The Country epic must check this before enabling writes.

- source_spec: `_bmad-output/implementation-artifacts/spec-8-12-purge-the-empty-legacy-drafts-the-import-could-not-convert.md`
  summary: Before the production purge, check that no row outside the purged trees references a heir inside them through `Heir.same_person` or `Deceased.heir`; both cascade on delete.
  evidence: Legacy views only link heirs within one calculation tree, so none is expected. Run a read-only query on production that counts such cross-root references; if any exist, resolve them before `purge_empty_legacy_drafts` runs.

- source_spec: `_bmad-output/implementation-artifacts/spec-9-2-render-the-family-as-lineage-cards-on-a-navigable-canvas.md`
  summary: Story 9.2 added or changed Interview tree and Heirs-list copy in ar, en and fr; every string needs native review before release.
  evidence: |-
    Keys in `web/src/i18n/messages.ts` (interview), en / ar / fr:
    - `treeDeceased`: "The deceased" / "المتوفى" / "La personne décédée" (one label for any gender is the owner decision; the female Arabic form is still open per EXPERIENCE.md).
    - `treeDiedBefore` male/female: "Died before" / "توفي قبله", "توفيت قبله" / "Décédé avant", "Décédée avant".
    - `treeDiedLater` male/female: "Died later · own estate" / "توفي لاحقاً · تركة مستقلة", "توفيت لاحقاً · تركة مستقلة" / "Décédé plus tard · succession propre", "Décédée plus tard · succession propre".
    - `treeNoShare`: "No share in this case" / "لا نصيب في هذه الحالة" / "Aucune part dans ce cas".
    - `treeAddParent`: "+ Add parent" / "+ إضافة أحد الوالدين" / "+ Ajouter un parent".
    - `treeAddSpouse` (new draft, not in the mock): "+ Add spouse" / "+ إضافة الزوج أو الزوجة" / "+ Ajouter un conjoint".
    - `treeFit`: "Fit tree" / "ملاءمة الشجرة" / "Ajuster l'arbre".
    - `treeZoomIn` / `treeZoomOut`: "Zoom in" / "Zoom out", "تكبير" / "تصغير", "Zoom avant" / "Zoom arrière".
    - `treeZoomStatus`: "Zoom {percent}" / "التكبير {percent}" / "Zoom {percent}".
    - `treeHint`: "Drag to move around the tree. Use the buttons to zoom." / "اسحب للتنقل في الشجرة. استخدم الأزرار للتكبير والتصغير." / "Faites glisser pour parcourir l'arbre. Utilisez les boutons pour zoomer."
    - `heirsEmpty` (changed): "No heirs yet. Press a relationship to add one." / "لا يوجد ورثة بعد. اضغط على صلة قرابة لإضافة وارث." / "Aucun héritier pour l'instant. Appuyez sur une relation pour en ajouter un."

- source_spec: `_bmad-output/implementation-artifacts/spec-9-3-add-one-relative-with-one-press.md`
  summary: Story 9.3 added Add relatives panel copy in ar, en and fr; every string needs native review before release.
  evidence: |-
    Keys in `web/src/i18n/messages.ts` (interview), en / ar / fr ("More relatives" reuses `heirMoreRelatives`):
    - `addRelativesHeading`: "Add relatives" / "إضافة أقارب" / "Ajouter des proches".
    - `addGroupSpouse`: "Spouse" / "الزوجية" / "Conjoint".
    - `addGroupParents`: "Parents" / "الوالدان" / "Parents".
    - `addGroupChildren`: "Children" / "الأبناء" / "Enfants".
    - `addGroupSiblings`: "Siblings" / "الإخوة والأخوات" / "Frères et sœurs".
    - `addRelative`: "Add {relationship}" / "إضافة {relationship}" / "Ajouter {relationship}".
    - `conflictNotice`: "This case changed in another tab. The latest version is shown, and your last change was not saved." / "تغيّرت هذه الحالة في نافذة أخرى. تُعرض الآن أحدث نسخة، ولم يُحفظ تغييرك الأخير." / "Ce dossier a été modifié dans un autre onglet. La dernière version est affichée et votre dernière modification n'a pas été enregistrée."

## Story 9.4

Native review pending for the following Arabic, English and French interview strings in `web/src/i18n/messages.ts`.

- `editClose`, `statusLegend`, `statusAlive`, `statusDiedBefore`
- `removeImpactIntro`, `removeImpactEstate`
- `fieldErrors.status.invalid`, `fieldErrors.status.schema_unsupported`, `fieldErrors.status.first_estate_only`, `fieldErrors.status.status_locked`

## Story 9.5

Native review is pending for these interview strings in `web/src/i18n/messages.ts`.

| Key | English | Arabic | French |
| --- | --- | --- | --- |
| `stepperFewer` | One fewer {relationship} | إنقاص عدد {relationship} | Diminuer le nombre ({relationship}) |
| `stepperMore` | One more {relationship} | زيادة عدد {relationship} | Augmenter le nombre ({relationship}) |
| `stepperCount` | Number of {relationship} to add | عدد من سيُضاف ({relationship}) | Nombre à ajouter ({relationship}) |
| `heirsAdded` | {count} × {relationship} added. | تمت إضافة {count} × {relationship}. | {count} × {relationship} ajoutés. |

## Story 9.6

Native review is pending for these interview strings in `web/src/i18n/messages.ts`.

| Key | English | Arabic | French |
| --- | --- | --- | --- |
| `undoLastChange` | Undo last change | تراجع عن آخر تغيير | Annuler la dernière modification |
| `undoAction` | Undo | تراجع | Annuler |
| `undoDone` | Last change undone. | تم التراجع عن آخر تغيير. | Dernière modification annulée. |
| `undoFailed` | That change could not be undone. Try again. | تعذّر التراجع عن هذا التغيير. حاول مرة أخرى. | Impossible d’annuler cette modification. Réessayez. |

## Story 9.7

Native review is pending for these interview strings in `web/src/i18n/messages.ts`.

| Key | English | Arabic | French |
| --- | --- | --- | --- |
| `addRelativeHere` | Add relative here | أضف قريبًا هنا | Ajouter un proche ici |
| `addHereGroup` | Relatives to add to {person} | الأقارب الذين يمكن إضافتهم إلى {person} | Proches à ajouter à {person} |
| `addHereNone` | No relatives can be added here. | لا يمكن إضافة أقارب هنا. | Aucun proche ne peut être ajouté ici. |
| `dropHere` | Drop here | أفلت هنا | Déposer ici |
| `dropNotHere` | Not allowed | غير مسموح | Non autorisé |
| `notAllowedHere` | Not allowed here: {reason} | غير مسموح هنا: {reason} | Non autorisé ici : {reason} |
| `positionNotAllowed` | {relationship} cannot be added at this person. | لا يمكن إضافة {relationship} عند هذا الشخص. | Impossible d’ajouter {relationship} à cette personne. |
| `fieldErrors.anchor.not_allowed` | That relative can no longer be added there. | لم يعد من الممكن إضافة هذا القريب هناك. | Ce proche ne peut plus être ajouté à cet endroit. |
| `fieldErrors.anchor.schema_unsupported` | This case cannot record who a relative belongs to yet. | لا يمكن لهذه الحالة تسجيل من ينتمي إليه القريب بعد. | Ce dossier ne peut pas encore enregistrer à qui un proche est rattaché. |

## Story 9.8

Arabic and French copy for later-death estates awaits native review.

| Key | English | Arabic | French |
| --- | --- | --- | --- |
| `statusDiedLater` | Died after the deceased, before division | توفي بعد المتوفى وقبل القسمة | Décédé après le défunt, avant le partage |
| `laterDeathLimit` | A case can hold up to two later deaths. | يمكن أن تتضمن الحالة وفاتين لاحقتين على الأكثر. | Un dossier peut comporter au plus deux décès ultérieurs. |
| `openOwnEstate` | Open own estate: {heir} | افتح التركة المستقلة: {heir} | Ouvrir la succession propre : {heir} |
| `laterDeathAddedMale` | {heir} died later. Open own estate to add his heirs. | توفي {heir} لاحقًا. افتح تركته المستقلة لإضافة ورثته. | {heir} est décédé plus tard. Ouvrez sa succession propre pour ajouter ses héritiers. |
| `laterDeathAddedFemale` | {heir} died later. Open own estate to add her heirs. | توفيت {heir} لاحقًا. افتحي تركتها المستقلة لإضافة ورثتها. | {heir} est décédée plus tard. Ouvrez sa succession propre pour ajouter ses héritiers. |
| `estateLevel` | Estate level | مستوى التركة | Niveau de succession |
| `fieldErrors.empty.invalid` | That request could not be read. | تعذرت قراءة هذا الطلب. | Cette demande n'a pas pu être lue. |

## Story 9.9: manual screen-reader release evidence (pending)

Keyboard and axe coverage is automated (unit, Playwright lineage navigation in en and ar, axe in ar, en and fr). Screen-reader verification is not claimed and stays a manual release item. Still owed: Arabic NVDA/Chrome, VoiceOver/Safari iOS and TalkBack runs over the canonical outline (add, edit, delete with cascade, Undo, open and return to an estate) with normal, blocked, died-before and died-later people. Each finding records browser, reader and action.

## Story 9.10

Native review of the new Interview status copy in Arabic and French, and screen-reader checks of the coalesced status, stay pending for a person.

| Key | English | Arabic | French |
| --- | --- | --- | --- |
| `previewReadyCount` | Heirs: {count}. Shares ready. | عدد الورثة: {count}. الأنصبة جاهزة. | Héritiers : {count}. Parts prêtes. |
| `previewStillWorking` | Still working on the preview… | ما زال تحديث المعاينة جاريًا… | Mise à jour de l'aperçu toujours en cours… |

Screen-reader check still owed: that the one polite atomic status speaks once per change (an add, a zoom, a slow preview and its result) with NVDA/Chrome, VoiceOver/Safari iOS and TalkBack, in Arabic and English. Each finding records browser, reader and action.

## Story 9.11

Automated and proven in Playwright: column geometry at 320, 639, 640, 1023, 1024, 1279 and 1280px in en and ar, 320px reflow with WCAG 1.4.12 text spacing, the obstruction contract, 300ms motion-safe card transitions, reduced motion, RTL derived from the registry, and axe at 320px and with the side panel open in light and dark.

Still pending for a person:

- Real 400% browser zoom of the Interview at 1280px (the 320px CSS-width run is a stand-in, not the same engine path).
- Real-device NVDA/Chrome, VoiceOver/Safari iOS and TalkBack runs over the responsive layouts, including the edit panel in the inline-end column and the modal sheet. Each finding records browser, reader and action.
- Epic 11 will register the sticky summary under the key `summary` in `useObstruction`; until then only the in-flow toast registers.

- source_spec: `_bmad-output/implementation-artifacts/spec-9-13-link-a-later-estate-heir-from-the-edit-sheet-and-retire-the-old-add-form.md`
  summary: Remove the dormant add-form draft machinery in `web/src/interview/flow.ts` (`heirFormKey`, `resetHeirForm`, `restoreHeirForm`, parked heir drafts, `formEpoch`) now that the old "Add an heir" form is gone.
  evidence: Story 9.13 removed the form but kept this state, because edit-sheet close/restore runs through it (about 17 call sites) and roughly 2,650 lines of `flow.test.ts` exercise it; it now maintains drafts no UI can resume.
- source_spec: `_bmad-output/implementation-artifacts/spec-9-13-link-a-later-estate-heir-from-the-edit-sheet-and-retire-the-old-add-form.md`
  summary: An Interview tab opened before a deploy that adds a Case row field (e.g. 9.13's `link_candidates`) rejects the new rows in its strict parser and drops later-estate heirs until reload.
  evidence: The old bundle's strict `ROW_KEYS` (`web/src/api/case.ts`) refuses unknown row keys; every additive contract change has this skew. A build-version reload prompt, or a tolerant parse for unknown row keys, would settle it (medium, unverified in a live deploy).
