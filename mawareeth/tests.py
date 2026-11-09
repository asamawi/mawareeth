import importlib.util
import json
import os
import re
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
from uuid import uuid4
from wsgiref.headers import Headers

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.management.commands import migrate
from django.db import OperationalError, connection, connections, migrations, models, transaction
from django.db.migrations.recorder import MigrationRecorder
from django.test import SimpleTestCase, TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from mawareeth.web_headers import add_web_headers


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SETTINGS_PATH = PROJECT_ROOT / "mawareeth" / "settings.py"


def load_settings_module(extra_env):
    module_name = f"mawareeth_settings_test_{uuid4().hex}"
    spec = importlib.util.spec_from_file_location(module_name, SETTINGS_PATH)
    module = importlib.util.module_from_spec(spec)
    env = {
        "DJANGO_ENV": "production",
        "DJANGO_KEY": "test-production-validation-key-with-sufficient-length-0123456789",
        "DJANGO_ALLOWED_HOSTS": "testserver,localhost,127.0.0.1,ci.example.com",
        "DJANGO_CSRF_TRUSTED_ORIGINS": "https://testserver,https://localhost,https://ci.example.com",
        "DATABASE_URL": "postgres://postgres:postgres@localhost:5432/mawareeth",
        "DATABASE_SSL_MODE": "disable",
        "BREVO_SMTP_KEY": "dummy",
        "BREVO_SMTP_LOGIN": "dummy",
    }
    env.update(extra_env)

    with patch.dict(os.environ, env, clear=True):
        assert spec.loader is not None
        spec.loader.exec_module(module)
    return module


class ProductionSettingsTests(SimpleTestCase):
    def test_next_dev_origins_are_trusted_outside_production_only(self):
        dev_origins = {"http://localhost:3000", "http://127.0.0.1:3000"}
        production = load_settings_module({})
        self.assertTrue(dev_origins.isdisjoint(production.CSRF_TRUSTED_ORIGINS))
        for mode in ("development", "test"):
            with self.subTest(mode=mode):
                module = load_settings_module({"DJANGO_ENV": mode})
                self.assertTrue(dev_origins <= set(module.CSRF_TRUSTED_ORIGINS))

    def test_app_version_comes_from_the_environment(self):
        settings_module = load_settings_module({"APP_VERSION": "3.0.7", "RELEASE_VERSION": "a" * 40})
        self.assertEqual(settings_module.APP_VERSION, "3.0.7")
        self.assertEqual(settings_module.RELEASE_VERSION, "a" * 40)

    def test_app_version_falls_back_to_the_version_file(self):
        base = (PROJECT_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        self.assertRegex(base, r"^\d+\.\d+$")
        for extra_env in ({}, {"APP_VERSION": ""}):
            with self.subTest(extra_env=extra_env):
                settings_module = load_settings_module(extra_env)
                self.assertEqual(settings_module.APP_VERSION, f"{base}.0-dev")
                self.assertEqual(settings_module.RELEASE_VERSION, f"{base}.0-dev")

    def test_blank_app_version_counts_as_unset(self):
        settings_module = load_settings_module({"APP_VERSION": "   "})
        self.assertTrue(settings_module.APP_VERSION.endswith(".0-dev"))

    def test_committed_version_file_is_exactly_what_publishing_accepts(self):
        # Matches deploy/version.sh, so a bad edit fails before it reaches master.
        raw = (PROJECT_ROOT / "VERSION").read_bytes().decode("utf-8")
        self.assertRegex(raw, r"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\n?\Z")

    def test_unusable_version_file_is_a_configuration_error(self):
        for name, read_text in (
            ("missing", Mock(side_effect=FileNotFoundError)),
            ("malformed", Mock(return_value="3.x\n")),
            ("empty", Mock(return_value="")),
        ):
            with self.subTest(name), patch("pathlib.Path.read_text", read_text):
                with self.assertRaises(ImproperlyConfigured):
                    load_settings_module({})

    def test_missing_production_secret_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DJANGO_KEY": ""})

    def test_missing_allowed_hosts_raise(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DJANGO_ALLOWED_HOSTS": ""})

    def test_missing_csrf_trusted_origins_raise(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DJANGO_CSRF_TRUSTED_ORIGINS": ""})

    def test_missing_database_ssl_mode_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DATABASE_SSL_MODE": ""})

    def test_missing_database_url_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DATABASE_URL": ""})

    def test_wildcard_host_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DJANGO_ALLOWED_HOSTS": "*"})

    def test_url_like_allowed_host_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DJANGO_ALLOWED_HOSTS": "https://ci.example.com"})

    def test_non_https_csrf_origin_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DJANGO_CSRF_TRUSTED_ORIGINS": "http://ci.example.com"})

    def test_csrf_origin_with_path_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DJANGO_CSRF_TRUSTED_ORIGINS": "https://ci.example.com/path"})

    def test_invalid_database_ssl_mode_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DATABASE_SSL_MODE": "sometimes"})

    def test_invalid_django_environment_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DJANGO_ENV": "preview"})

    def test_nonpositive_database_connect_timeout_raises(self):
        with self.assertRaises(ImproperlyConfigured):
            load_settings_module({"DATABASE_CONNECT_TIMEOUT": "0"})

    def test_explicit_database_ssl_mode_is_applied(self):
        module = load_settings_module({"DATABASE_SSL_MODE": "disable"})
        self.assertEqual(module.DATABASES["default"]["OPTIONS"]["sslmode"], "disable")
        self.assertFalse(module.DEBUG)

    def test_unverified_database_ssl_mode_raises(self):
        with self.assertRaisesRegex(ImproperlyConfigured, "DATABASE_SSL_MODE"):
            load_settings_module({"DATABASE_SSL_MODE": "require"})

    def test_opportunistic_database_ssl_mode_raises(self):
        with self.assertRaisesRegex(ImproperlyConfigured, "DATABASE_SSL_MODE"):
            load_settings_module({"DATABASE_SSL_MODE": "prefer"})

    def test_opportunistic_database_ssl_mode_allowed_outside_production(self):
        module = load_settings_module({"DJANGO_ENV": "development", "DATABASE_SSL_MODE": "prefer"})
        self.assertEqual(module.DATABASES["default"]["OPTIONS"]["sslmode"], "prefer")

    def test_verified_database_ssl_mode_without_root_cert_raises(self):
        for mode in ("verify-ca", "verify-full"):
            with self.subTest(mode=mode), self.assertRaisesRegex(ImproperlyConfigured, "DATABASE_SSL_ROOT_CERT"):
                load_settings_module({"DATABASE_SSL_MODE": mode})

    def test_verified_database_ssl_mode_with_missing_root_cert_file_raises(self):
        with self.assertRaisesRegex(ImproperlyConfigured, "DATABASE_SSL_ROOT_CERT"):
            load_settings_module(
                {"DATABASE_SSL_MODE": "verify-full", "DATABASE_SSL_ROOT_CERT": str(PROJECT_ROOT / "missing-ca.pem")}
            )

    def test_verified_database_ssl_mode_without_root_cert_allowed_outside_production(self):
        module = load_settings_module({"DJANGO_ENV": "development", "DATABASE_SSL_MODE": "verify-full"})
        self.assertNotIn("sslrootcert", module.DATABASES["default"]["OPTIONS"])

    def test_verified_database_ssl_mode_applies_root_cert(self):
        with TemporaryDirectory() as directory:
            root_cert = Path(directory) / "db-ca.pem"
            root_cert.write_text("test CA", encoding="utf-8")
            module = load_settings_module(
                {"DATABASE_SSL_MODE": "verify-full", "DATABASE_SSL_ROOT_CERT": str(root_cert)}
            )
        options = module.DATABASES["default"]["OPTIONS"]
        self.assertEqual(options["sslmode"], "verify-full")
        self.assertEqual(options["sslrootcert"], str(root_cert))

    def test_missing_brevo_credentials_raise(self):
        for name in ("BREVO_SMTP_KEY", "BREVO_SMTP_LOGIN"):
            with self.subTest(name=name), self.assertRaisesRegex(ImproperlyConfigured, name):
                load_settings_module({name: ""})

    def test_production_sends_through_brevo_over_tls(self):
        module = load_settings_module({"BREVO_SMTP_LOGIN": "login@smtp-brevo.com", "BREVO_SMTP_KEY": "secret"})
        self.assertEqual(module.EMAIL_BACKEND, "django.core.mail.backends.smtp.EmailBackend")
        self.assertEqual((module.EMAIL_HOST, module.EMAIL_PORT), ("smtp-relay.brevo.com", 587))
        self.assertTrue(module.EMAIL_USE_TLS)
        self.assertEqual(module.EMAIL_HOST_USER, "login@smtp-brevo.com")
        self.assertEqual(module.EMAIL_HOST_PASSWORD, "secret")
        self.assertEqual(module.EMAIL_TIMEOUT, 10)
        self.assertEqual(module.DEFAULT_FROM_EMAIL, "noreply@mawareeth.com")

    def test_development_never_sends_real_mail(self):
        module = load_settings_module({"DJANGO_ENV": "development"})
        self.assertEqual(module.EMAIL_BACKEND, "django.core.mail.backends.console.EmailBackend")

    def test_runtime_snapshot_optional_keys_reach_settings(self):
        # deploy/runtime.sh emits these exact names into the app snapshot.
        module = load_settings_module(
            {
                "SITE_ID": "2",
                "FACEBOOK_KEY": "123456789012345",
                "FACEBOOK_SECRET": "facebook-secret",
                "LINKEDIN_KEY": "linkedin-key",
                "LINKEDIN_SECRET": "linkedin-secret",
            }
        )
        self.assertEqual(module.SITE_ID, 2)
        self.assertEqual(module.SOCIAL_AUTH_FACEBOOK_KEY, 123456789012345)
        self.assertEqual(module.SOCIAL_AUTH_FACEBOOK_SECRET, "facebook-secret")
        self.assertEqual(module.SOCIAL_AUTH_LINKEDIN_OPENIDCONNECT_KEY, "linkedin-key")
        self.assertEqual(module.SOCIAL_AUTH_LINKEDIN_OPENIDCONNECT_SECRET, "linkedin-secret")

    def test_health_middleware_runs_before_host_and_https_enforcement(self):
        module = load_settings_module({})
        self.assertEqual(module.MIDDLEWARE[0], "mawareeth.middleware.HealthCheckMiddleware")


class OpsEndpointTests(TestCase):
    def test_liveness_endpoint_returns_ok(self):
        response = self.client.get(reverse("ops-live"), secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(response.content, {"status": "ok", "service": "mawareeth"})

    def test_readiness_endpoint_returns_ok(self):
        response = self.client.get(reverse("ops-ready"), secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(response.content, {"status": "ok", "database": "ok", "schema": "ok"})

    def test_readiness_endpoint_returns_503_without_diagnostics(self):
        with patch("mawareeth.ops_views._database_ready", return_value=False):
            response = self.client.get(reverse("ops-ready"), secure=True)
        self.assertEqual(response.status_code, 503)
        self.assertJSONEqual(response.content, {"status": "error"})

    def test_readiness_endpoint_hides_database_exception(self):
        with (
            patch("mawareeth.ops_views._database_ready", side_effect=RuntimeError("password leaked")),
            self.assertLogs("mawareeth.ops_views", level="ERROR") as logs,
        ):
            response = self.client.get(reverse("ops-ready"), secure=True)
        self.assertEqual(response.status_code, 503)
        self.assertJSONEqual(response.content, {"status": "error"})
        self.assertIn("password leaked", "\n".join(logs.output))

    def test_readiness_endpoint_returns_503_with_unapplied_migrations(self):
        with (
            patch(
                "mawareeth.ops_views.MigrationExecutor.migration_plan",
                return_value=[("pending-migration", False)],
            ),
            self.assertLogs("mawareeth.ops_views", level="WARNING") as logs,
        ):
            response = self.client.get(reverse("ops-ready"), secure=True)
        self.assertEqual(response.status_code, 503)
        self.assertJSONEqual(response.content, {"status": "error"})
        self.assertIn("unapplied migrations", "\n".join(logs.output))

    def test_readiness_ignores_migrations_applied_by_a_newer_release(self):
        # During expand/migrate the new release records migrations this
        # release's graph does not contain; the old slot must stay ready.
        MigrationRecorder(connection).record_applied("calc", "9999_applied_by_newer_release")
        response = self.client.get(reverse("ops-ready"), secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(response.content, {"status": "ok", "database": "ok", "schema": "ok"})

    @override_settings(APP_VERSION="3.0.7", RELEASE_VERSION="build-2026-09-02", RELEASE_COMMIT_SHA="abc1234")
    def test_release_identity_endpoint_returns_expected_markers(self):
        response = self.client.get(reverse("ops-release"), secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["version"], "3.0.7")
        self.assertEqual(response.json()["release"], "build-2026-09-02")
        self.assertEqual(response.json()["commit"], "abc1234")

    def test_health_responses_are_not_cacheable(self):
        for name in ("ops-live", "ops-ready", "ops-release"):
            with self.subTest(name=name):
                response = self.client.get(reverse(name), secure=True)
                self.assertIn("no-store", response["Cache-Control"])


def _is_postgresql():
    return connection.vendor == "postgresql"


@unittest.skipUnless(_is_postgresql(), "readiness timeouts apply to PostgreSQL only")
class ReadinessTimeoutTests(SimpleTestCase):
    # SimpleTestCase keeps the connection in autocommit, as in production, so
    # the probe's atomic block is a real transaction rather than a savepoint
    # inside a test transaction (where SET LOCAL would outlive the block).
    databases = {"default"}

    def _show(self, name):
        with connections["default"].cursor() as cursor:
            cursor.execute(f"SHOW {name}")
            return cursor.fetchone()[0]

    def test_readiness_sets_local_timeouts_without_leaking_them(self):
        before = {name: self._show(name) for name in ("statement_timeout", "lock_timeout")}
        seen = {}

        def schema_ready_spy():
            for name in before:
                seen[name] = self._show(name)
            return True

        with patch("mawareeth.ops_views._schema_ready", side_effect=schema_ready_spy):
            response = self.client.get(reverse("ops-ready"), secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen, {"statement_timeout": "2s", "lock_timeout": "2s"})
        after = {name: self._show(name) for name in before}
        self.assertEqual(after, before)

    def test_timed_out_query_yields_diagnostic_free_503(self):
        def stalled_database():
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT pg_sleep(10)")
            return True

        started = time.monotonic()
        with (
            patch("mawareeth.ops_views._database_ready", side_effect=stalled_database),
            self.assertLogs("mawareeth.ops_views", level="ERROR") as logs,
        ):
            response = self.client.get(reverse("ops-ready"), secure=True)
        elapsed = time.monotonic() - started

        self.assertEqual(response.status_code, 503)
        self.assertJSONEqual(response.content, {"status": "error"})
        self.assertLess(elapsed, 5)
        output = "\n".join(logs.output)
        self.assertIn("statement timeout", output)
        self.assertIn(OperationalError.__name__, output)

    def test_inside_outer_atomic_block_no_set_local_is_issued(self):
        # A savepoint would not scope SET LOCAL, so the probe leaves the
        # caller's transaction settings alone.
        before = self._show("statement_timeout")
        with transaction.atomic(using="default"):
            with CaptureQueriesContext(connections["default"]) as queries:
                response = self.client.get(reverse("ops-ready"), secure=True)
            during = self._show("statement_timeout")

        self.assertEqual(response.status_code, 200)
        self.assertFalse([q["sql"] for q in queries.captured_queries if "SET LOCAL" in q["sql"].upper()])
        self.assertEqual(during, before)


class ContractGatePatternTests(SimpleTestCase):
    """release.sh matches Django's own `migrate --plan` wording."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        script = (PROJECT_ROOT / "deploy" / "release.sh").read_text(encoding="utf-8")
        match = re.search(r"^contract_pattern='([^']+)'$", script, re.MULTILINE)
        if match is None:
            raise AssertionError("contract_pattern not found in deploy/release.sh")
        cls.pattern = re.compile(match.group(1))

    def _plan_line(self, operation):
        # migrate --plan prints each operation as four spaces plus this text.
        text, _ = migrate.Command.describe_operation(operation, False)
        return "    " + text

    def test_contract_operations_match(self):
        operations = [
            migrations.RemoveField("heir", "share"),
            migrations.DeleteModel("Heir"),
            migrations.RenameField("heir", "name", "full_name"),
            migrations.RenameModel("Heir", "Inheritor"),
            migrations.AlterModelTable("heir", "calc_heir"),
            migrations.RunSQL("DROP TABLE calc_heir"),
            migrations.SeparateDatabaseAndState(state_operations=[migrations.DeleteModel("Heir")]),
        ]
        for operation in operations:
            line = self._plan_line(operation)
            with self.subTest(operation=type(operation).__name__, line=line):
                self.assertRegex(line, self.pattern)

    def test_additive_operations_do_not_match(self):
        operations = [
            migrations.AddField("heir", "note", models.TextField(default="")),
            migrations.CreateModel("Heir", [("id", models.AutoField(primary_key=True))]),
        ]
        for operation in operations:
            line = self._plan_line(operation)
            with self.subTest(operation=type(operation).__name__, line=line):
                self.assertNotRegex(line, self.pattern)


@override_settings(ALLOWED_HOSTS=["mawareeth.example"], SECURE_SSL_REDIRECT=True)
class PrivateHealthProbeTests(TestCase):
    """Probes from inside the Compose network use plain HTTP and slot hostnames."""

    def test_private_probes_bypass_host_validation_and_https_redirect(self):
        for host in ("app-blue:8000", "localhost:8000", "mawareeth.example"):
            for name in ("ops-live", "ops-ready", "ops-release"):
                with self.subTest(host=host, name=name):
                    response = self.client.get(reverse(name), HTTP_HOST=host)
                    self.assertEqual(response.status_code, 200)

    def test_head_probe_is_answered(self):
        response = self.client.head(reverse("ops-live"), HTTP_HOST="app-green:8000")
        self.assertEqual(response.status_code, 200)

    def test_probes_without_trailing_slash_are_answered(self):
        for path in ("/health/live", "/health/ready", "/health/release"):
            with self.subTest(path=path):
                response = self.client.get(path, HTTP_HOST="app-blue:8000")
                self.assertEqual(response.status_code, 200)

    def test_probe_responses_keep_security_headers(self):
        response = self.client.get(reverse("ops-live"), HTTP_HOST="app-blue:8000")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["Referrer-Policy"], "same-origin")

    @override_settings(SECURE_HSTS_SECONDS=31536000)
    def test_public_https_probe_responses_carry_hsts(self):
        response = self.client.get(reverse("ops-live"), HTTP_HOST="mawareeth.example", secure=True)
        self.assertIn("max-age=31536000", response["Strict-Transport-Security"])

    def test_other_paths_still_enforce_allowed_hosts(self):
        response = self.client.get("/health/live/extra", HTTP_HOST="app-blue:8000")
        self.assertEqual(response.status_code, 400)

    def test_non_read_methods_on_health_paths_are_not_bypassed(self):
        response = self.client.post(reverse("ops-live"), HTTP_HOST="app-blue:8000")
        self.assertEqual(response.status_code, 400)

    def test_public_requests_still_redirect_to_https(self):
        response = self.client.get(reverse("calc:home"), HTTP_HOST="mawareeth.example")
        self.assertEqual(response.status_code, 301)
        self.assertTrue(response["Location"].startswith("https://mawareeth.example/"))


class WebExportTests(TestCase):
    """The export is a build artifact, so these use a stand-in for it."""

    ASSET = "/app/_next/static/chunks/abc123.js"

    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        for locale, direction in (("ar", "rtl"), ("en", "ltr"), ("fr", "ltr")):
            page = root / "app" / locale / "index.html"
            page.parent.mkdir(parents=True)
            page.write_text(f'<!DOCTYPE html><html lang="{locale}" dir="{direction}"></html>', encoding="utf-8")
        asset = root / self.ASSET.lstrip("/")
        asset.parent.mkdir(parents=True)
        asset.write_text("console.log(1)", encoding="utf-8")
        overridden = override_settings(WHITENOISE_ROOT=root)
        overridden.enable()
        self.addCleanup(overridden.disable)

    def test_shell_page_has_language_direction_and_headers(self):
        for locale, direction in (("ar", "rtl"), ("en", "ltr"), ("fr", "ltr")):
            with self.subTest(locale=locale):
                response = self.client.get(f"/app/{locale}/", secure=True)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response["Content-Type"].startswith("text/html"))
                self.assertEqual(response["X-Frame-Options"], "DENY")
                self.assertEqual(response["X-Robots-Tag"], "noindex")
                self.assertEqual(response["Cache-Control"], "no-cache")
                self.assertIn("ETag", response)
                content = b"".join(response.streaming_content).decode()
                self.assertIn(f'lang="{locale}"', content)
                self.assertIn(f'dir="{direction}"', content)

    def test_unknown_locale_is_404(self):
        self.assertEqual(self.client.get("/app/de/", secure=True).status_code, 404)

    def test_hashed_asset_is_immutable_for_one_year(self):
        response = self.client.get(self.ASSET, secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "public, max-age=31536000, immutable")
        self.assertEqual(response["X-Frame-Options"], "DENY")
        response.close()

    def test_missing_asset_is_404(self):
        response = self.client.get("/app/_next/static/chunks/missing.js", secure=True)
        self.assertEqual(response.status_code, 404)

    def test_existing_routes_still_respond(self):
        self.assertEqual(self.client.get("/ar/", secure=True).status_code, 200)
        self.assertEqual(self.client.get("/health/ready/", secure=True).status_code, 200)


class WebRootRedirectTests(TestCase):
    def assertRedirectsTo(self, response, location):
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], location)

    def test_defaults_to_arabic(self):
        self.assertRedirectsTo(self.client.get("/app/", secure=True), "/app/ar/")

    def test_unsupported_language_falls_back_to_arabic(self):
        response = self.client.get("/app/", secure=True, headers={"accept-language": "de"})
        self.assertRedirectsTo(response, "/app/ar/")

    def test_follows_accept_language(self):
        response = self.client.get("/app/", secure=True, headers={"accept-language": "fr-FR,fr;q=0.9"})
        self.assertRedirectsTo(response, "/app/fr/")

    def test_cookie_wins_over_accept_language(self):
        self.client.cookies[settings.LANGUAGE_COOKIE_NAME] = "en"
        response = self.client.get("/app/", secure=True, headers={"accept-language": "fr"})
        self.assertRedirectsTo(response, "/app/en/")

    def test_keeps_the_query_string(self):
        response = self.client.get('/app/?utm_source=x&a=1', secure=True, headers={'Accept-Language': 'en'})
        self.assertEqual(response['Location'], '/app/en/?utm_source=x&a=1')

    def test_redirect_is_not_cached_or_indexed(self):
        response = self.client.get("/app/", secure=True)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertEqual(response["X-Robots-Tag"], "noindex")
        self.assertIn("Cookie", response["Vary"])
        self.assertIn("Accept-Language", response["Vary"])

    def test_post_is_rejected(self):
        self.assertEqual(self.client.post("/app/", secure=True).status_code, 405)


class WebExportAbsentTests(TestCase):
    @override_settings(WHITENOISE_ROOT=None)
    def test_shell_page_404s_while_redirect_and_api_work(self):
        self.assertEqual(self.client.get("/app/ar/", secure=True).status_code, 404)
        self.assertEqual(self.client.get("/app/", secure=True).status_code, 302)
        self.assertEqual(self.client.get("/api/v1/session/", secure=True).status_code, 200)

    def test_settings_only_set_whitenoise_root_when_the_export_exists(self):
        with patch("pathlib.Path.is_dir", return_value=False):
            self.assertFalse(hasattr(load_settings_module({}), "WHITENOISE_ROOT"))
        with patch("pathlib.Path.is_dir", return_value=True):
            module = load_settings_module({})
        self.assertEqual(module.WHITENOISE_ROOT, module.BASE_DIR / "web-dist")


class WebHeadersTests(SimpleTestCase):
    def test_static_files_keep_their_immutable_headers(self):
        immutable = "max-age=315360000, public, immutable"
        headers = Headers([("Cache-Control", immutable)])
        add_web_headers(headers, "/srv/staticfiles/site.abc123.css", "/static/site.abc123.css")
        self.assertEqual(headers.items(), [("Cache-Control", immutable)])


class WorkflowContractTests(SimpleTestCase):
    def test_validation_workflow_contains_required_release_gates(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "django.yml").read_text(encoding="utf-8")
        required_commands = [
            "python manage.py makemigrations --check --dry-run",
            "python manage.py migrate --noinput",
            "python manage.py collectstatic --noinput",
            "python manage.py check --deploy --fail-level WARNING",
            "python manage.py test --parallel auto --durations 20",
        ]
        for command in required_commands:
            with self.subTest(command=command):
                executable_step = rf"- name: [^\n]+\n(?: +[^\n]+\n)*? +run: {re.escape(command)}(?:\n|$)"
                match = re.search(executable_step, workflow)
                self.assertIsNotNone(match)
                self.assertNotRegex(match.group(0), r"(?m)^ +if: false$")

    @unittest.skipUnless((PROJECT_ROOT / "web").is_dir(), "the release image has no frontend sources")
    def test_export_locales_match_django_languages(self):
        codes = sorted(code for code, _name in settings.LANGUAGES)
        web = PROJECT_ROOT / "web"
        messages = (web / "src" / "i18n" / "messages.ts").read_text(encoding="utf-8")
        locales = re.search(r"locales = \[([^\]]*)\]", messages).group(1)
        self.assertEqual(sorted(re.findall(r'"([a-z-]+)"', locales)), codes)
        check = (web / "scripts" / "check-export.mjs").read_text(encoding="utf-8")
        expected = re.search(r"expected = \{([^}]*)\}", check).group(1)
        self.assertEqual(sorted(re.findall(r"([a-z-]+):", expected)), codes)

    @unittest.skipUnless((PROJECT_ROOT / "web").is_dir(), "the release image has no frontend sources")
    def test_node_version_is_the_same_everywhere(self):
        web = PROJECT_ROOT / "web"
        nvmrc = (web / ".nvmrc").read_text(encoding="utf-8").strip()
        engines = json.loads((web / "package.json").read_text(encoding="utf-8"))["engines"]["node"]
        dockerfile = (PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")
        image = re.search(r"FROM node:([0-9.]+)-slim@sha256:", dockerfile).group(1)
        self.assertEqual({nvmrc, engines, image}, {nvmrc})

    def test_image_build_fails_on_static_or_deploy_check_errors(self):
        dockerfile = (PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertRegex(
            dockerfile,
            r"python manage\.py collectstatic --noinput && \\\n(?:.*\\\n)*?"
            r" +python manage\.py check --deploy --fail-level WARNING\n",
        )

    def test_publish_workflow_gates_untrusted_runs(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        required_snippets = (
            "github.event.workflow_run.conclusion == 'success'",
            "github.event.workflow_run.event == 'push'",
            "github.event.workflow_run.head_branch == 'master'",
            "branches: [master]",
            "ref: ${{ github.event.workflow_run.head_sha }}",
        )
        for snippet in required_snippets:
            with self.subTest(snippet=snippet):
                self.assertIn(snippet, workflow)

    def test_publish_workflow_builds_smokes_pushes_and_manifests_in_order(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        ordered_steps = (
            "- name: Build release image once",
            "- name: Smoke-test release image",
            "- name: Preflight release manifest inputs",
            "- name: Push smoke-tested image",
            "- name: Build and validate release manifest",
            "- name: Upload release manifest",
        )
        positions = [workflow.index(step) for step in ordered_steps]

        self.assertEqual(positions, sorted(positions))
        self.assertEqual(workflow.count("docker/build-push-action@"), 1)
        self.assertIn("load: true", workflow)
        self.assertIn("push: false", workflow)
        self.assertIn("/health/live/", workflow)
        self.assertIn("/health/release/", workflow)
        self.assertIn('data["release"] == expected and data["commit"] == expected', workflow)
        self.assertIn('docker push "$IMAGE_TAG"', workflow)
        self.assertIn("steps.push.outputs.digest", workflow)
        self.assertIn("release_manifest.py validate --input release-manifest.json", workflow)
        self.assertEqual(workflow.count('--expected-repository "${{ steps.image.outputs.repository }}"'), 3)
        self.assertNotIn("release-metadata.json", workflow)

    def test_publish_workflow_numbers_the_image_and_tags_only_after_publishing(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        ordered_steps = (
            "fetch-depth: 0",
            "- name: Derive release version",
            "- name: Build release image once",
            "- name: Push smoke-tested image",
            "- name: Upload release manifest",
            "tag-release:",
        )
        positions = [workflow.index(step) for step in ordered_steps]
        self.assertEqual(positions, sorted(positions))

        self.assertIn("APP_VERSION=${{ steps.version.outputs.version }}", workflow)
        self.assertIn("RELEASE_VERSION=${{ github.event.workflow_run.head_sha }}", workflow)
        self.assertIn("RELEASE_COMMIT_SHA=${{ github.event.workflow_run.head_sha }}", workflow)
        self.assertIn('data["version"] == os.environ["EXPECTED_VERSION"]', workflow)
        self.assertIn('deploy/version.sh check-tag "$version"', workflow)

        # Only the job that runs after a complete publish can write to the repository.
        self.assertRegex(workflow, r"(?m)^permissions:\n  contents: read\n  packages: write$")
        self.assertEqual(workflow.count("contents: write"), 1)
        tag_job = workflow[workflow.index("  tag-release:") :]
        self.assertRegex(tag_job, r"(?m)^    needs: publish$")
        self.assertRegex(tag_job, r"(?m)^    permissions:\n      contents: write$")
        self.assertNotRegex(tag_job, r"(?m)^ +(if|continue-on-error):")
        self.assertIn('deploy/version.sh tag "$VERSION" "$COMMIT_SHA"', tag_job)

    def test_image_build_passes_app_version_in_every_stage(self):
        dockerfile = (PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r"(?m)^ARG APP_VERSION=$", dockerfile)), 2)
        self.assertEqual(dockerfile.count('APP_VERSION="$APP_VERSION"'), 3)
        ignored = (PROJECT_ROOT / ".dockerignore").read_text(encoding="utf-8").split()
        self.assertNotIn("VERSION", ignored)

    def test_validation_workflow_builds_image_and_validates_caddyfile_before_merge(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "django.yml").read_text(encoding="utf-8")
        jobs = {}
        jobs_section = workflow[workflow.index("\njobs:\n") :]
        for match in re.finditer(r"(?m)^  ([a-z][a-z0-9-]*):\n((?:(?: {4}[^\n]*| *)\n)*)", jobs_section):
            self.assertNotIn(match.group(1), jobs)
            jobs[match.group(1)] = match.group(2)

        self.assertIn("image-build", jobs)
        image_build = jobs["image-build"]
        self.assertIn("docker/build-push-action@", image_build)
        self.assertIn("context: .", image_build)
        self.assertRegex(image_build, r"(?m)^ +push: false$")
        self.assertNotIn("load: true", image_build)
        self.assertNotIn("push: true", workflow)
        self.assertNotIn("docker push", workflow)
        self.assertNotIn("docker/login-action", workflow)

        self.assertIn("caddy-config", jobs)
        caddy = jobs["caddy-config"]
        self.assertIn("deploy/runtime-images.lock", caddy)
        self.assertIn("@sha256:[0-9a-f]{64}$", caddy)
        validate = "caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile --validate"
        # Blue and green routes in the default acme mode, then the cloudflare
        # and cloudflare-aop edge modes, then the broken-copy self-test.
        self.assertEqual(caddy.count(validate), 4)
        self.assertEqual(caddy.count('-v "$PWD/deploy/caddy/edge:/etc/caddy/edge:ro"'), 4)
        self.assertIn("-e EDGE_MODE=cloudflare -e REDIRECT_DOMAIN=ci.example.com", caddy)
        self.assertIn("-e EDGE_MODE=cloudflare-aop -e REDIRECT_DOMAIN=ci.example.com", caddy)
        # The cloudflare and cloudflare-aop steps each mount the Origin directory.
        self.assertEqual(caddy.count('-v "$origin:/etc/caddy/origin-tls:ro"'), 2)
        self.assertIn("extendedKeyUsage=clientAuth", caddy)
        self.assertIn('client.get("mode") == "require_and_verify"', caddy)
        self.assertIn("the client-auth policy for", caddy)
        self.assertIn("a catch-all TLS policy lacks client authentication while strict_sni_host is off", caddy)
        self.assertIn('server.get("strict_sni_host") is not True', caddy)
        self.assertIn('-v "$origin:/etc/caddy/origin-tls:ro"', caddy)
        self.assertIn("openssl req -x509", caddy)
        self.assertIn('"{http.request.uri}"', caddy)
        self.assertIn('as_dict(server.get("trusted_proxies"))', caddy)
        self.assertIn('.get("disable_certificates") is not True', caddy)
        self.assertIn('handler.get("handler") == "reverse_proxy"', caddy)
        self.assertIn('server.get("tls_connection_policies")', caddy)
        self.assertIn('as_dict(issuer).get("module") in ("acme", "zerossl")', caddy)
        self.assertEqual(caddy.count("docker run --rm --network none"), caddy.count("docker run"))
        self.assertIn("for slot in blue green; do", caddy)
        self.assertIn('"\\"dial\\":\\"app-$slot:8000\\""', caddy)
        self.assertIn("accepts invalid config", caddy)
        self.assertNotRegex(caddy, r"caddy:\d|sha256:[0-9a-f]{64}")

        for name in ("image-build", "caddy-config"):
            with self.subTest(job=name):
                self.assertRegex(jobs[name], r"(?m)^    timeout-minutes: \d+$")
                self.assertRegex(jobs[name], r"(?m)^    permissions:\n      contents: read$")
                self.assertNotRegex(jobs[name], r"(?m)^ +if:")

    def test_validation_workflow_gates_on_the_web_job(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "django.yml").read_text(encoding="utf-8")
        jobs_section = workflow[workflow.index("\njobs:\n") :]
        match = re.search(r"(?m)^  web:\n((?:(?: {4}[^\n]*| *)\n)*)", jobs_section)
        self.assertIsNotNone(match)
        job = match.group(1)
        self.assertIn("node-version-file: web/.nvmrc", job)
        for command in (
            "npm ci",
            "npm run lint",
            "npm run typecheck",
            "npm test",
            "npm run build",
            "node scripts/check-export.mjs",
        ):
            with self.subTest(command=command):
                self.assertRegex(job, rf"(?m)^ +run: {re.escape(command)}$")
        self.assertNotRegex(job, r"(?m)^ +(if|continue-on-error):")

    def test_publish_smoke_test_covers_the_frontend_and_api(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        start = workflow.index("- name: Smoke-test release image")
        smoke = workflow[start : workflow.index("- name: Preflight release manifest inputs")]
        for snippet in ("X-Forwarded-Proto: https", "/app/ar/", 'dir="rtl"', "/app/_next/static/", "/api/v1/session/"):
            with self.subTest(snippet=snippet):
                self.assertIn(snippet, smoke)

    def _production_deploy_workflow(self):
        return (PROJECT_ROOT / ".github" / "workflows" / "deploy-production.yml").read_text(encoding="utf-8")

    def test_production_deploy_is_dispatch_only(self):
        workflow = self._production_deploy_workflow()
        on_section = re.search(r"(?m)^on:\n((?:(?: +[^\n]*)?\n)*?)(?=^\S)", workflow)
        self.assertIsNotNone(on_section)
        triggers = re.findall(r"(?m)^  ([a-z_]+):", on_section.group(1))
        self.assertEqual(triggers, ["workflow_dispatch"])
        inputs = re.findall(r"(?m)^      ([a-z_-]+):$", on_section.group(1))
        self.assertEqual(inputs, ["sha"])
        for trigger in ("push:", "pull_request", "workflow_run", "schedule:", "repository_dispatch"):
            with self.subTest(trigger=trigger):
                self.assertNotIn(trigger, workflow)

    def test_production_deploy_is_gated_and_serialized(self):
        workflow = self._production_deploy_workflow()
        self.assertRegex(workflow, r"(?m)^    environment: production$")
        self.assertRegex(workflow, r"(?m)^concurrency:\n  group: deploy-production\n  cancel-in-progress: false$")
        self.assertNotIn("cancel-in-progress: true", workflow)
        self.assertRegex(workflow, r"(?m)^permissions:\n  contents: read$")

    def test_production_deploy_validates_sha_before_anything_else(self):
        workflow = self._production_deploy_workflow()
        jobs_section = workflow[workflow.index("\njobs:\n") :]
        first_job = re.search(r"(?m)^  ([a-z][a-z0-9-]*):\n", jobs_section)
        self.assertIsNotNone(first_job)
        self.assertEqual(first_job.group(1), "validate-input")
        validate = jobs_section[first_job.end() : jobs_section.index("\n  deploy:\n")]
        self.assertIn("SHA: ${{ inputs.sha }}", validate)
        self.assertIn('[[ "$SHA" =~ ^[0-9a-f]{40}$ ]]', validate)
        self.assertNotIn("uses:", validate)
        self.assertNotIn("environment:", validate)
        self.assertIn("    needs: validate-input\n", workflow)
        # The SHA reaches scripts only through the environment, never inlined;
        # the run name only displays it.
        self.assertEqual(workflow.count("${{ inputs.sha }}"), workflow.count("SHA: ${{ inputs.sha }}") + 1)
        self.assertEqual(workflow.count("\nrun-name: Deploy ${{ inputs.sha }}\n"), 1)
        deploy = jobs_section[jobs_section.index("\n  deploy:\n") :]
        self.assertLess(deploy.index('[[ "$SHA" =~ ^[0-9a-f]{40}$ ]]'), deploy.index("uses: tailscale/github-action@"))

    def test_production_deploy_reaches_the_host_only_over_tailscale_with_a_pinned_key(self):
        workflow = self._production_deploy_workflow()
        self.assertLess(workflow.index("uses: tailscale/github-action@"), workflow.index("ssh -T"))
        self.assertIn("tags: tag:ci-deploy", workflow)
        self.assertIn("-o StrictHostKeyChecking=yes", workflow)
        self.assertIn('-o UserKnownHostsFile="$dir/known_hosts"', workflow)
        self.assertIn("-o GlobalKnownHostsFile=/dev/null", workflow)
        self.assertIn("-o BatchMode=yes", workflow)
        self.assertNotRegex(workflow, r"StrictHostKeyChecking=(?!yes)")
        self.assertNotIn("ssh-keyscan", workflow)
        self.assertEqual(workflow.count("ssh -T"), 1)
        # The SHA is the only payload sent to the host.
        self.assertRegex(workflow, r'(?m)^ +"mawareeth-deploy@\$DEPLOY_HOST" "\$SHA" 2>&1 \| tee "\$dir/output" \|\| status=\$\?$')

    def test_production_deploy_secrets_appear_only_in_env_or_with_mappings(self):
        workflow = self._production_deploy_workflow()
        lines = workflow.splitlines()
        references = [index for index, line in enumerate(lines) if "${{ secrets." in line]
        self.assertEqual(len(references), 3)
        for index in references:
            line = lines[index]
            with self.subTest(line=line.strip()):
                self.assertRegex(line, r"^ +[A-Za-z_-]+: \$\{\{ secrets\.[A-Z_]+ \}\}$")
                indent = len(line) - len(line.lstrip())
                parent = next(
                    lines[earlier]
                    for earlier in range(index - 1, -1, -1)
                    if lines[earlier].strip() and len(lines[earlier]) - len(lines[earlier].lstrip()) < indent
                )
                self.assertIn(parent.strip(), ("env:", "with:"))
        # No run block body contains an expression at all.
        run_blocks = re.findall(r"(?m)^( +)run: \|\n((?:\1 +[^\n]*\n|\n)*)", workflow)
        self.assertTrue(run_blocks)
        for _, body in run_blocks:
            self.assertNotIn("${{", body)

    def test_production_deploy_runs_from_master_with_no_token_and_reports(self):
        workflow = self._production_deploy_workflow()
        self.assertEqual(workflow.count("\n    if: github.ref == 'refs/heads/master'\n"), 2)
        deploy = workflow[workflow.index("\n  deploy:\n") :]
        self.assertRegex(deploy, r"(?m)^    permissions: \{\}$")
        self.assertIn('>> "$GITHUB_STEP_SUMMARY"', deploy)
        self.assertIn("s/^ci-deploy: result=//p", deploy)
        self.assertIn('if [ -z "$DEPLOY_SSH_KEY" ]; then', deploy)
        self.assertIn("printf '%s\\n' \"$DEPLOY_SSH_KEY\" | tr -d '\\r'", deploy)

    def test_production_deploy_never_allows_contract_or_recover(self):
        workflow = self._production_deploy_workflow()
        for forbidden in ("--allow-contract", "recover", "release.sh", "runtime.sh", "docker", "manifest.json"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, workflow)

    def test_workflows_pin_third_party_actions(self):
        for name in ("deploy.yml", "django.yml", "deploy-production.yml"):
            workflow = (PROJECT_ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
            action_references = re.findall(r"(?m)^\s*(?:-\s+)?uses:\s*(\S+)", workflow)

            with self.subTest(workflow=name):
                self.assertTrue(action_references)
                self.assertEqual(len(action_references), workflow.count("uses:"))
            for reference in action_references:
                with self.subTest(workflow=name, reference=reference):
                    self.assertRegex(reference, r"^[^@]+@[0-9a-f]{40}$")
