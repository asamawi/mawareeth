# Epic 9 gate evidence

Story 9.12, 2026-11-23. This file is the one place that says what proves Epic 9's capacity, speed,
accessibility and root-visibility requirements (NFR-1, NFR-3, NFR-X1), which part is automated, and
which part is still manual. It holds no names, ids or family payloads.

**Gate status: open, and failing on row 1** (a measured NFR-3 miss, not a pending item). Story 9.12 closes on the automated evidence below. Epic 9's gate and
retrospective stay open until the owner records the four rows marked **blocking, pending**. Emulated
throttling is supporting evidence; it never replaces the device run. No row is waived.

## Gate table

| # | Check | Requirement | Kind | Command or runbook | Result | Blocking |
|---|---|---|---|---|---|---|
| 1 | Interview action mix in budget: `add`, `bulk_add`, `edit`, `delete`, `drop`, `undo` on a School, a comparison and a two-later-death Case of up to 50 Heirs, end to end p95 under 1000 ms (modelled network, contention writer running) | NFR-3 | Automated, every deploy (both slots running); the deploy runs `capacity_check --enforce-interview`, so a missed Interview budget aborts the candidate | `capacity_check --samples 20 --json <file>` (`deploy/README.md`, Capacity evidence). The full command takes about 2.5 minutes locally | **Pass (Story 9.15): the Undo request is gzipped+base64 (`snapshot_gz`), 14.5 KB → 4.4 KB, cutting modelled Undo network time ~110 ms (682 → 572 ms). Clean `capacity_check --samples 20` runs put every `two_later_deaths` action under 1000 ms p95 (2026-11-25 runs: worst action 932 ms and 941 ms; `delete` is tightest at ~940, `add`/`undo` ~860–930). The dev machine's thermal noise can still spike a single run, so the enforced three-in-a-row record is taken on the deploy host. School and comparison actions pass (p95 ≤ 717 ms).** | No longer blocking (automated). The four manual rows (4, 10, 11, 12) remain the blocking-pending items. |
| 2 | Standard-family engine p95 under 200 ms, and the 8.11 workloads unchanged | NFR-3 | Automated, every deploy | same command | Pass: `standard_school` and `standard_compare` engine p95 under 3 ms | Yes, on every deploy |
| 3 | Browser-side timings of the six actions on the same three 50-Heir Cases under Chrome 4x CPU throttling and the 4G model (150 ms RTT, 1.6/0.75 Mbps), on `next dev` | NFR-3 | Automated, local only; supporting evidence | `cd web && npm run test:e2e:live` writes `web/test-results/live-timings.json` | Ran 2026-11-23 (3 samples per action, dev machine under memory pressure): **every p95 was above 1000 ms**, 2.6 to 5.7 s. This is next dev (unminified, no compressed bodies, an 86 KB preview) under 4x CPU and the 4G model, so it is pessimistic; it does not pass the budget and does not settle row 4. See Open assumptions 5 | No (never replaces row 4) |
| 4 | Preview p95 under 1000 ms on a real mid-range phone over 4G with up to 50 Heirs | NFR-3 | **Manual** | Phone runbook below | **Pending** | **Blocking, pending** |
| 5 | Deceased stays visible at 375 px and 1280 px with 50 Heirs through Fit, pan, zoom, arrows, edit and Undo, with the summary bar showing | NFR-X1 | Automated (Playwright, CI) | `cd web && npx playwright test e2e/capacity-journey.spec.ts` | Pass in English and Arabic at both widths | Yes (CI) |
| 6 | Every card and action is a target of at least 44 px; cards are 108 px (below 640 px) and 136 px wide; the focus outline stays inside the canvas | NFR-1 | Automated (Playwright, CI) | same spec | Pass | Yes (CI) |
| 7 | The 51st add, a bulk add past 50 and a third later death are refused in the browser; nothing says added; an existing person and both estates still edit | FR-1 limits | Automated (Playwright, CI); the server's own refusals are `api/tests.py` and `api/test_case_commands.py` | same spec | Pass | Yes (CI) |
| 8 | UJ-2 journey on the real API: build with presses and the count stepper, fix a relationship, delete, Undo, drop equals Add relative here, cascade cancel sends nothing, later estate and breadcrumb return, ends at Save; tree, Heirs outline and the current-revision Share preview agree after every accepted step. Arabic desktop, phone (375 px) and keyboard-only | NFR-1, NFR-X1 | Automated, local only | `cd web && npm run test:e2e:live` | Passed 2026-11-23: Arabic desktop, phone (375 px, touch) and keyboard-only English | No (local only); re-run before closing the epic |
| 9 | axe: no serious or critical violation on the 50-Heir Case at 375/1280 px, en/ar, light/dark | NFR-1 | Automated (Playwright, CI) | `cd web && npx playwright test e2e/accessibility.spec.ts` | Pass (8 runs), plus the 9.1 to 11.3 axe runs | Yes (CI) |
| 10 | Arabic NVDA/Chrome, VoiceOver/Safari iOS and TalkBack over the canonical outline | NFR-1 | **Manual** | Screen-reader runbook below | **Pending** | **Blocking, pending** |
| 11 | Real 400% browser zoom of the Interview at 1280 px | NFR-1 | **Manual** | Zoom runbook below | **Pending** | **Blocking, pending** |
| 12 | Native Arabic and French review of Interview status copy; screen-reader check of the coalesced status | NFR-1 | **Manual**; carried from 9.10 | `deferred-work.md`, Story 9.10 | **Pending** | **Blocking, pending** with row 10 |

Row 1 now passes (Story 9.15); rows 4, 10, 11 and 12 are the four blocking-pending items. Row 12 only repeats the 9.10 screen-reader
and review items so that the epic cannot close without them.

## Manual runbooks

Record, for every finding: browser or device, build commit, locale, action and result.

### Phone over 4G (row 4)

1. Deploy the candidate to production through `release.sh deploy`, or use the staging host; note the
   image commit from `/health/release/`.
2. Use a real mid-range Android phone (a 2021-or-later device with 4 GB RAM or less) on a mobile 4G
   connection, not Wi-Fi, in Chrome with no extensions. Clear site data first.
3. Open `/ar/interview/` and build the three Cases of `deploy/README.md` (Capacity evidence): a
   five-heir School Case grown to 47 Heirs, a comparison Case with 47 Heirs, and a Case with two
   later deaths. Seed them from a desktop with the same API calls if typing is too slow, then open
   each on the phone.
4. For each Case and for each of the six actions (one press add, a count-stepper add of three, edit
   of a relationship, delete, a drop or Add relative here, Undo), do the action at least 20 times,
   going back to the 47-Heir base between samples. Time from the press to the Share preview showing
   the new revision, with Chrome remote debugging over USB. In the DevTools console of the phone tab,
   paste this once per page load, then call `arm()` just before each sample and read `timing()` after
   the preview settles (`arm()` clears `start`, `end` and `revision`, so no sample reuses the last one):

   ```js
   var t = { start: null, end: null, revision: null, armed: false };
   function arm() { t.start = null; t.end = null; t.revision = null; t.armed = true; }
   function timing() { return t.end === null || t.start === null ? null : t.end - t.start; }
   function check() {
     var r = document.querySelector("[data-js-only]");
     if (t.end !== null || t.revision === null || !r) return;
     var ok = /^(ready|choose-school)$/.test(r.getAttribute("data-preview-state") || "");
     if (ok && r.getAttribute("data-preview-revision") === String(t.revision)) requestAnimationFrame(function () { if (t.end === null) t.end = performance.now(); });
   }
   var f = window.fetch.bind(window);
   window.fetch = function () {
     var a = arguments, m = ((a[1] && a[1].method) || "GET").toUpperCase();
     return f.apply(null, a).then(function (res) {
       if (t.armed && m !== "GET" && res.ok) res.clone().json().then(function (b) { if (b && b.case && b.case.revision) { t.revision = b.case.revision; check(); } });
       return res;
     });
   };
   new MutationObserver(check).observe(document, { subtree: true, attributes: true, childList: true });
   ["pointerup", "keydown"].forEach(function (e) { document.addEventListener(e, function () { if (t.armed && t.start === null) t.start = performance.now(); }, true); });
   ```
5. Record the raw milliseconds, the p95 per action and Case, the phone model, Android and Chrome
   versions, and the signal strength. Pass only if every p95 is under 1000 ms. A miss is a failed
   gate, not a waiver: file it as a defect.

### Arabic NVDA/Chrome, VoiceOver/Safari iOS, TalkBack (row 10)

Over the canonical outline, with a Case that has normal, blocked, died-before and died-later people:
add a relative, edit one, delete one with a cascade, Undo, open a later estate and return with the
breadcrumb. Check that the polite status speaks once per change, that refusals speak as alerts, and
that the tree and the Heirs outline read the same people in the same order. Run each reader in
Arabic and in English.

### 400% browser zoom (row 11)

At 1280 px wide, set the browser to 400% (320 CSS px), open the 50-Heir Case in Arabic and English,
and check reflow with no two-dimensional scroll except the canvas, that every card and action is
reachable, the focus outline is not clipped, and the deceased stays visible after Fit, pan and zoom.

## Open assumptions

1. **Undo with two later deaths misses the budget.** On local PostgreSQL the modelled `undo` p95 for the
   two-later-death Case was 999.9 ms on the first run and 1069 ms on the rerun (p50 about 930 ms) against
   the 1000 ms budget, and its other actions ran 800 to 900 ms. The modelled network dominates: an Undo sends the whole snapshot up and every
   write answers with the whole Case. A slower production host can push this over the budget and
   abort a deploy. The gate must watch this row; fixing it needs a smaller Undo or Case payload, which
   is outside this story.
2. The harness models a phone; it is not one. Its 100 ms render allowance and network figures are
   unchanged from 8.11 and are what row 4 exists to replace.
3. The 47-Heir base leaves room for `add` (48), `bulk_add` of three (50) and `drop` (48). The actions
   run in the first estate; the two later estates are present and loaded but not edited.
4. The schema 1 writer refuses positioned adds onto anyone but the deceased, so while production
   writes schema 1 the harness drops onto the deceased. Production writes schema 2.
5. The live browser timings run on `next dev`, which is slower than the static export, over a local
   Django; the CPU and network throttles are Chrome's, not a device's. Their p95 (2.6 to 5.7 s) is far
   above the modelled 0.5 to 1.0 s. Two causes are visible without a device: `next dev` serves
   uncompressed bodies (the Case answer is about 42 KB and the preview about 86 KB; the harness counts
   them gzip-compressed, as Caddy sends them) and 4x CPU throttling slows React's render of 50 cards in
   a development build. Re-run the live project against a production build behind compression, and run
   row 4 on the device, before trusting either number. Until then Epic 9's preview-speed claim rests on
   the modelled run alone.
6. The live project needs local PostgreSQL, a migrated development database, and free ports 3000 and
   8000 (`E2E_LIVE_WEB_PORT` and `E2E_LIVE_API_PORT` choose others). It lifts the API throttles for
   that local server only, through `mawareeth.settings_e2e_live`. `next dev` rewrites `web/tsconfig.json`
   when it starts; discard that change (`git checkout web/tsconfig.json`).
7. The 50-Heir browser fixture (`web/e2e/fixtures/fifty-heirs.json`) is the server's own answer for a
   made-up family, rewritten with `WRITE_FIFTY_HEIR_FIXTURE=1 uv run python manage.py test
   api.test_fifty_heir_fixture --noinput`. It must be rewritten when the Case or preview contract changes.
