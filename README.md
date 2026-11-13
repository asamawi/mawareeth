# Mawareeth

[Mawareeth](https://www.mawareeth.com/) is a free, open-source web calculator for Islamic inheritance. It divides an estate among the heirs under the four Sunni schools of law and shows every step of the calculation with the rule it relies on. Its results are a calculation aid, not a fatwa or legal advice.

The first version is still online at [v1.mawareeth.com](http://v1.mawareeth.com).

## Features

- **No account needed.** A guided interview asks about the deceased and the surviving relatives, and shows each heir's share as you go.
- **The four Sunni schools.** Mawareeth works out the case under the Hanafi, Maliki, Shafi'i and Hanbali schools. When they agree you get one result. When they differ (for example a grandfather with brothers, radd or the mushtaraka), it names the rule behind the difference, shows each school's result and asks you to choose.
- **Proof.** Every share comes with the steps, the Quranic verse or school rule behind it, the scholars' inheritance table, percentages and qirat. Awl and radd are handled.
- **Successive deaths (munasakhat).** An heir who died before the estate was divided passes their share on to their own heirs.
- **Draft PDF report** of the case and its results. The estate amount is optional, so a case can be worked out as shares only.
- **Save and share.** With an account, save cases and share them by private link, email invitation or WhatsApp. Sign-in by password, Facebook or LinkedIn.
- **Arabic, English and French**, with right-to-left layout for Arabic.

## How it is built

| Part | Location | Technology |
|------|----------|------------|
| Web app | [`web/`](web/) | Next.js, React and Tailwind, built as a static export |
| API | [`api/`](api/) | Django REST Framework under `/api/v1/` |
| Calculation engine | [`calc/`](calc/) | Python; school differences live in [`calc/schools.py`](calc/schools.py) |
| PDF reports | [`reports/`](reports/) | WeasyPrint |
| Site settings, headers, health checks | [`mawareeth/`](mawareeth/) | Django |
| Production | [`deploy/`](deploy/) | Docker Compose with blue-green releases behind Caddy and Cloudflare |

One Django process serves both the API and the static export. Requests to `/` go to the Arabic landing page unless the visitor has chosen another language.

## Local development

You need Python 3.12 with [uv](https://docs.astral.sh/uv/), PostgreSQL, and the Node version in [`web/.nvmrc`](web/.nvmrc).

By default Django connects to the PostgreSQL database `mydb_mawareeth` on `localhost:5432` as `postgres`/`postgres`. Set `DATABASE_URL`, or `DATABASE_NAME`, `DB_USER` and `DB_PASS`, to use another.

```bash
uv run python manage.py migrate
uv run python manage.py runserver        # API on http://localhost:8000

cd web
npm ci
npm run dev                              # site on http://localhost:3000
```

Open <http://localhost:3000/>. In development the Next server forwards `/api/` to Django, so the browser sees one origin. See [`web/README.md`](web/README.md) for the frontend.

## Tests

The Django tests need PostgreSQL. For a quick local run, keep the test database between runs and skip the exhaustive engine sweeps:

```bash
uv run python manage.py test --keepdb --parallel auto --exclude-tag slow
```

Run the full suite, as CI does, before opening a pull request:

```bash
uv run python manage.py test --keepdb --parallel auto
```

Tests that run the engine many times derive from `TransactionTestCase`, not `TestCase`. Inside `TestCase`'s per-test transaction each engine run is a savepoint, and once a transaction holds more than 64 subtransactions PostgreSQL slows every query sharply.

The web app has unit tests and Playwright browser tests; see [`web/README.md`](web/README.md). Deployment scripts have shell test suites under [`deploy/tests/`](deploy/tests/).

## Deployment

Production runs on a Hetzner host. The release image holds the Django app and the Next.js export, and releases switch between two slots so a deploy can roll back. Merges to `master` build the image, and production deploys need approval. Host setup, backups, monitoring and the release procedure are documented in [`deploy/README.md`](deploy/README.md).

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change, and update the tests as appropriate.

Inheritance rulings and the Arabic and French wording benefit from review by people qualified in fiqh and by native speakers. Corrections are especially welcome.

## License

Mawareeth is licensed under the GNU Affero General Public License v3.0 ([AGPL-3.0](https://choosealicense.com/licenses/agpl-3.0/)).

Permissions of this strongest copyleft license are conditioned on making available complete source code of licensed works and modifications, which include larger works using a licensed work, under the same license. Copyright and license notices must be preserved. Contributors provide an express grant of patent rights. When a modified version is used to provide a service over a network, the complete source code of the modified version must be made available.
