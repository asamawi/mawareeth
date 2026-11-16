# Review: current-technology reality check of the Phase 2 architecture spine

Reviewed: ARCHITECTURE-SPINE.md (2026-11-16). Lens: were the committed technology decisions reality-checked against current sources, or asserted from training data. Checks run 2026-11-16 (web fetches of PyPI, npm registry, endoflife.date, MCP spec, Brevo docs, Cloudflare docs; Babel exercised locally with `uv run --with babel==2.18.0`).

## Verdict

The stack pins all exist, but several are not the latest patch, and two decisions rest on facts that are wrong or unstated: the MCP section names no spec revision while the current revision (2026-07-28) changed the transport, and the Brevo inbound webhook has no documented authentication, so "the webhook is authenticated" has no mechanism behind it. Babel does not use Arabic-Indic, Extended Arabic-Indic or Devanagari digits unless the numbering system is passed explicitly, which the spine does not say.

## Summary table

| # | Item | Status |
| --- | --- | --- |
| 1a | Babel 2.18.0 current | confirmed |
| 1b | Babel ISO 4217 minor units | confirmed |
| 1c | Babel Arabic-Indic / Urdu / Hindi / Chinese digits | risk (not default; must be explicit) |
| 2a | MCP spec revision | outdated/unstated (current is 2026-07-28) |
| 2b | Stateless JSON-only Streamable HTTP spec-compliant | confirmed for 2026-07-28; risk for older-era clients |
| 2c | Hosted clients (Claude, ChatGPT) accept it | unverified |
| 2d | MCP Python SDK 2.x as test client; version | confirmed exists (2.3.0 latest), conformance unverified |
| 3a | Brevo inbound parse exists | confirmed |
| 3b | Payload | confirmed (shape noted below) |
| 3c | Webhook authentication | risk (no documented inbound auth; no signing) |
| 3d | `t-<token>@reply.<domain>` routing | confirmed with caveat (routing is per domain; token read from To/Recipients) |
| 4a | WeasyPrint 70.0 exists | confirmed |
| 4b | RTL / Arabic / Urdu Nastaliq | unverified (no authoritative doc; some docs contradict) |
| 4c | Chinese / Devanagari fonts | risk (Dockerfile has fonts-noto-core only) |
| 5a | Django 5.2.17 | outdated (5.2.19 current) |
| 5b | Django 5.2 LTS window | confirmed (security to 2028-04-30) |
| 5c | DRF 3.18.3 | confirmed (latest) |
| 5d | Next.js 16.4.5 | outdated (16.4.6 current) |
| 5e | React 19.3.0 | outdated (19.3.1 current) |
| 5f | TypeScript 5.9.3 | outdated (7.0.2 is `latest`; 5.9.3 pinned is deliberate-compatible) |
| 5g | PostgreSQL 17.11 (inherited) | outdated (17.12 current) |
| 6 | CF-IPCountry | confirmed with caveat (must be enabled; special values) |

## 1. Babel

**1a. Version: confirmed.** 2.18.0 is on PyPI, uploaded 2026-02-01 (https://pypi.org/project/Babel). The local run reports `babel.__version__ == 2.18.0`. I could not confirm that nothing newer exists past the search result; PyPI listed 2.18.0 as latest.

**1b. Minor units: confirmed.** Run locally: `format_currency` gives 2 decimals for EGP/USD, 3 for KWD, 0 for JPY in every locale tried. Note Babel takes these from CLDR currency data, not from an ISO 4217 table directly. AD-19 says "ISO 4217 minor unit"; the two agree for the Phase 2 currencies today, but the integer-minor-unit conversion (`amount_minor`) must use the same source, or the rounding line and the formatted string can disagree. Use `babel.numbers.get_currency_precision(code)` for both.

**1c. Digits: risk.** Local results with Babel 2.18.0:

- `Locale('ar').default_numbering_system == 'latn'`; `ur`, `zh`, `hi`, `ur_PK` also `latn`. Only `ar_EG` defaults to `arab`.
- `format_decimal(1234567.89, locale='ar', numbering_system='arab')` gives `1٬234٬567٫89`. `ur` with `numbering_system='arabext'` gives Extended Arabic-Indic digits. `hi` with `deva` gives Latin digits shown as `12,34,567.89` (Devanagari digits are not applied: `deva` output was Latin in my run, so Devanagari digits are not produced by the Babel number data for `hi`; check before promising Devanagari digits).
- Hindi grouping is lakh/crore (`12,34,567.89`): correct and useful.
- `zh` with `hanidec` returned Latin digits too; Chinese Locales normally use Latin digits anyway.
- Urdu currency symbols are weak: `EGP`, `KWD` render as the ISO code with no Urdu name, and `ur` USD renders `$1٬234٫50`. Arabic uses localised names (`ج.م.`, `د.ك.`) and a leading RLM.
- `format_currency` with Locale `ar` and `numbering_system='latn'` is supported, so a per-Locale "digit system" setting in the locale registry (AD-21) is implementable.

Suggested spine fix: in AD-19 and the AD-21 registry state that the numbering system is passed explicitly to every Babel call (`numbering_system=` from the registry), because Babel defaults to Latin for `ar`, `ur`, `hi`. Add a note that Devanagari and Urdu currency names need a per-Locale visual check, and a Beta label stays until a native reader signs off. Use `get_currency_precision` for the minor-unit conversion.

Sources: https://pypi.org/project/Babel ; local run output above; https://babel.pocoo.org/en/latest/numbers.html

## 2. MCP

**2a. Spec revision: outdated/unstated.** The spine never names a revision. The current revision is **2026-07-28** (https://modelcontextprotocol.io/specification/latest/changelog ; https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http.md). It removed the `initialize` handshake, protocol-level sessions (`Mcp-Session-Id`) and the GET stream endpoint. Every POST must carry `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` (for `tools/call`, `resources/read`, `prompts/get`) headers, and the body carries `_meta` with protocol version and client info; the server must return `400` with JSON-RPC `-32020` (`HeaderMismatch`) on mismatch and validate `Origin` (403 if present and invalid).

**2b. Stateless, JSON-only: confirmed.** Under 2026-07-28 the server "MUST return either `application/json` or `text/event-stream`" per request, and the client MUST support both. So plain JSON, no SSE and no session is spec-compliant, and is in fact the natural shape. A 2026-07-28-only server should answer `GET`/`DELETE` with 405, ignore `Mcp-Session-Id`, and ignore `Last-Event-ID`.

**Risk: two eras.** Earlier revisions (2025-03-26 to 2025-11-25) use `initialize` + optional sessions. Clients "detect the counterpart's era" and fall back to `initialize` when a modern request returns a non-modern 400. A server that only implements 2026-07-28 will be unusable by any hosted client still on the older era. A server that wants both must implement `initialize`/`notifications/initialized`/`tools/list` for old clients (still stateless: not issuing a session id is allowed in the old spec) and the new header-validated path for new ones. The spine says nothing about which.

**2c. Hosted clients: unverified.** Secondary sources say Claude custom connectors support Streamable HTTP and legacy HTTP+SSE (https://claude.com/docs/connectors/building.md ; https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers) and that OpenAI requires Streamable HTTP at a stable `/mcp` URL (https://developers.openai.com/apps-sdk/build/mcp-server). I found no first-party statement of which spec revision each hosted client sends today or that they accept a JSON-only, no-session server. Authentication is also unspecified: hosted connectors may expect OAuth or no auth; the spine's "no login, optional API key" model needs a check against what each client UI allows.

**2d. SDK: confirmed exists.** `mcp` on PyPI: latest **2.3.0** (requires Python >=3.10); 1.x line ran to 1.30.0 (2026-09-07). v2 moved `json_response`, `stateless_http` and path options off the constructor onto `run()` / `streamable_http_app()`; one beta report says `stateless_http` defaults to false, so a test must set it for the server side. That applies to Python servers; our server is a Django view, so the SDK is only the test client. Whether the v2 client speaks only 2026-07-28 or falls back to `initialize` against a server is not established; and the SDK has no published conformance-suite result I could find. "CI runs the official SDK client against it" is a reasonable smoke test, but not proof of conformance to hosted clients.

Suggested spine fix: (1) In AD-22 name the target revision(s): "MCP 2026-07-28, stateless, JSON responses only; also answer the 2025-11-25 `initialize` era without issuing session ids" or explicitly drop the old era with a stated reason. (2) State the required behaviors: `Origin` validation, `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` validation with 400 `-32020`, 405 on GET/DELETE, `Accept` handled (clients send both types). (3) In Stack, pin `mcp` to a concrete 2.x (2.3.0 today) rather than "2.x"; keep CI-only, and add that CI also runs the old-era `initialize` flow if both are supported. (4) Add an owner-run manual test against real Claude and ChatGPT connectors before FR-39/FR-40 ship; list that as a known unverified.

Sources: https://modelcontextprotocol.io/specification/latest/changelog ; https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http.md ; https://pypi.org/pypi/mcp/json ; https://py.sdk.modelcontextprotocol.io/whats-new/ ; https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/

## 3. Brevo inbound parse

**3a/3b. Exists and payload: confirmed** (https://developers.brevo.com/docs/inbound-parse-webhooks). Webhook type `inbound`, event `inboundEmailProcessed`, JSON body with an `items` array. Per item: `Uuid` (list), `MessageId`, `InReplyTo`, `From`, `To`, `Cc`, `ReplyTo`, `Recipients` (RCPT TO), `SentAtDate`, `Subject`, `SpamScore`/`Spam.Score` (docs table and sample disagree), `RawHtmlBody`, `RawTextBody`, `ExtractedMarkdownMessage`, `ExtractedMarkdownSignature`, `Attachments` with `DownloadToken`, and headers. The webhook is configured with a `domain` field; the domain must be verified with Brevo.

**3d. Reply subdomain routing: confirmed with caveat.** Brevo recommends a separate receiving subdomain such as `reply.yourdomain.com`, with two MX records to `inbound1.sendinblue.com.` (10) and `inbound2.sendinblue.com.` (20). Routing is per domain: all mail to `*@reply.<domain>` is POSTed to one URL. There is no per-address rule, so the handler must extract `<token>` from `Recipients` (best, it is the envelope address) or `To`. `t-<token>@reply.<domain>` therefore works, provided the handler does not trust `To` alone (Bcc and forwarding put the address only in `Recipients`). `MessageId`/`InReplyTo` are available for idempotency.

**3c. Authentication: risk.** The inbound page says nothing about auth, retries or size limits. For Brevo webhooks generally: basic auth via `https://user:pass@host/` in the webhook URL, custom headers on webhook creation ("token authentication"), and an IP allowlist (Brevo publishes ranges; Brevo supports no inbound whitelisting on its own side) (https://developers.brevo.com/docs/secured-webhooks ; https://developers.brevo.com/docs/username-and-password-authentication ; https://help.brevo.com/hc/en-us/articles/15127404548498). Brevo does **not sign** payloads (https://hookdeck.com/webhooks/platforms/guide-to-brevo-webhooks-features-and-best-practices). Whether these options apply to inbound-type webhooks is not documented. Retry-on-failure behaviour and body size cap for inbound are also undocumented, which matters for the AD-8/AD-24 "idempotent" claim.

Suggested spine fix: AD-24 should say how the webhook is authenticated: a long random secret as a path segment or custom header (compared in constant time), and optionally Brevo's published IP ranges as a second check at Caddy/nginx; state that there is no payload signature. Read the token from `Recipients`, dedupe on `MessageId`. Mark "inbound webhook auth, retry and size behaviour" as to be confirmed in a spike against a real Brevo account before the support stories start. Also record that Brevo's inbound domain needs its own MX records and verification (DNS change in the edge config).

## 4. WeasyPrint 70.0

**4a. Exists: confirmed.** Docs title and PyPI latest are 70.0; changelog: released 2026-09-08, a security update (CVE-2026-55073: no EPS rendering, always use the original URL fetcher) (https://doc.courtbouillon.org/weasyprint/stable/changelog.html). Requires Python >=3.10 and Pango >=1.44 (https://doc.courtbouillon.org/weasyprint/stable/first_steps.html). The repo pins `weasyprint==70.0` and the Dockerfile installs `libpango`, `libpangoft2`, `libharfbuzz-subset0` and `fonts-noto-core`.

**4b. RTL / Arabic / Urdu: unverified.** Text is laid out by Pango, which uses HarfBuzz for shaping, so Arabic joining and bidi are expected to work. But the docs' API-reference page lists "Right-to-left or bi-directional text" among unsupported CSS 2.1 features (stale-looking, contradicting changelog entries that fix RTL alignment in 69.0 and RTL SVG anchoring in 70.0) (https://doc.courtbouillon.org/weasyprint/stable/api_reference.html). I found no authoritative statement on Nastaliq. Noto Nastaliq Urdu is an SIL OFL font with tall, deeply stacked glyphs whose vertical positioning has had bugs in some shaping stacks (WebKit: https://onbugs.webkit.org/show_bug.cgi?id=255972); line height and clipping in a PDF are a real risk. Phase 1 already ships Arabic PDFs (the repo uses WeasyPrint), which de-risks Arabic but not Urdu Nastaliq, Hindi or Chinese.

**4c. Fonts: risk.** The Dockerfile installs `fonts-noto-core` only. On Debian, that package covers Arabic and Devanagari and, as far as I know, Noto Nastaliq Urdu, but not CJK (`fonts-noto-cjk` is separate). I did not verify the Debian package contents; treat as unverified. Chinese PDFs would render `.notdef` boxes (WeasyPrint logs a warning) without a CJK font.

Suggested spine fix: add to AD-21/`reports` a per-Locale PDF font stack in the Locale registry (Arabic: Noto Naskh/Sans Arabic; Urdu: Noto Nastaliq Urdu with enlarged line-height; Hindi: Noto Sans Devanagari; Chinese: Noto Sans SC via `fonts-noto-cjk`), and install/bundle those fonts in the image (size cost noted). Add a CI/known-answer PDF rendering test per Locale that fails on any WeasyPrint "glyph not found" warning. Treat Urdu and Hindi PDF as Beta until a native reader approves the rendering.

## 5. Framework and runtime versions

| Pin in spine | Exists | Current | Status |
| --- | --- | --- | --- |
| Django 5.2.17 | yes (repo pins it) | 5.2.19 (LTS), 6.0.10, 6.1.3 | outdated patch |
| DRF 3.18.3 | yes | 3.18.3 (supports Django 5.2/6.0/6.1, Python 3.10 to 3.15) | confirmed |
| Next.js 16.4.5 | yes (npm registry) | 16.4.6 (2026-11-09) | outdated patch |
| React 19.3.0 | yes (npm registry) | 19.3.1 (2026-10-14) | outdated patch |
| TypeScript 5.9.3 | yes | `latest` dist-tag is 7.0.2 | stale major, defensible |
| PostgreSQL 17.11 | n/a (inherited) | 17.12; EOL 2029-11-08 | outdated patch |
| WeasyPrint 70.0 | yes | 70.0 | confirmed |
| Babel 2.18.0 | yes | 2.18.0 | confirmed |
| Python 3.12 | n/a | repo `>=3.12,<3.13` | fine |

- Django 5.2 is an LTS: security support until **2028-04-30** (https://endoflife.date/django). That covers Phase 2.
- Next.js 16.4.5 requires Node >=20.9 and accepts React `^18.2 || ^19` (https://registry.npmjs.org/next/16.4.5).
- TypeScript 7 is a new major (the native compiler line); staying on 5.9.3 under Next 16 is safe but should be a stated choice, not an unchecked one.
- Patch lag matters for Django (5.2.18 and 5.2.19 are security/bugfix releases) and for WeasyPrint-style security fixes. I did not read the 5.2.18/5.2.19 notes to judge severity.

Suggested spine fix: Stack table: change to Django 5.2.19, Next.js 16.4.6, React 19.3.1, PostgreSQL 17.12, with a rule "pin to the latest patch of the named minor at implementation time; a Dependabot/Renovate PR keeps patches current". Note TypeScript 5.9.3 as a deliberate hold (TS 7 not adopted in Phase 2). Verify whether the production host actually runs PostgreSQL 17.11 or 17.12 before editing.

Sources: https://endoflife.date/api/django.json ; https://endoflife.date/api/nextjs.json ; https://endoflife.date/api/react.json ; https://endoflife.date/api/postgresql.json ; https://pypi.org/pypi/djangorestframework/json ; https://registry.npmjs.org/typescript/latest ; https://registry.npmjs.org/react/19.3.0

## 6. Cloudflare CF-IPCountry

**Confirmed with caveats.** IP geolocation adds `CF-IPCountry` to requests to the origin, on all plans (Free to Enterprise). It must be turned on: Network > IP Geolocation, or the "Add visitor location headers" Managed Transform (https://developers.cloudflare.com/network/ip-geolocation/). The page I fetched does not list the special values; from Cloudflare's header reference I recall `XX` (unknown) and `T1` (Tor), which I did not re-verify here. Also, the header can be forged unless the origin only accepts traffic from Cloudflare (the spine's Hetzner host is reached through Cloudflare, but a direct-to-origin request would carry whatever header the client sends).

Suggested spine fix: promote the `[ASSUMPTION]` to a rule: IP Geolocation enabled in the zone; the app accepts `CF-IPCountry` only if the origin is reachable solely through Cloudflare (firewall or authenticated origin pulls); values that are not two uppercase letters, plus `XX` and `T1`, map to `unknown`. Because event rows are per day x event x Locale x country, a forged header would only skew counts, so severity is low.

## Findings that need a spine change (condensed)

1. Stack: Django 5.2.17 to 5.2.19, Next.js 16.4.5 to 16.4.6, React 19.3.0 to 19.3.1, PostgreSQL 17.11 to 17.12; state TypeScript 5.9.3 is a deliberate hold (7.0.2 is current).
2. Stack: pin MCP SDK to a concrete version (2.3.0 now); AD-22 must name the MCP spec revision (2026-07-28) and whether the older `initialize` era is also served.
3. AD-22: add the 2026-07-28 transport requirements (Origin check, `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` validation with 400 `-32020`, 405 on GET/DELETE) and a manual check against real Claude and ChatGPT connectors; hosted-client acceptance is unverified.
4. AD-24: define webhook authentication (secret in URL path or header, constant-time compare, optional Brevo IP ranges; Brevo does not sign), read the token from `Recipients`, dedupe on `MessageId`, and flag retry and size behaviour as unverified until a spike.
5. AD-19/AD-21: Babel defaults to Latin digits for `ar`, `ur`, `hi`, `zh`; pass `numbering_system` from the Locale registry explicitly, take minor units from `get_currency_precision`, and flag Urdu currency names and Devanagari digits for visual review.
6. AD-21/`reports`: add a per-Locale PDF font stack; the Dockerfile has `fonts-noto-core` only, so Chinese needs `fonts-noto-cjk` and Urdu Nastaliq needs a layout check; add a "glyph not found" CI check.
7. Deferred list: promote the CF-IPCountry assumption to a rule (zone setting enabled, origin reachable only via Cloudflare, `XX`/`T1`/invalid map to `unknown`).
