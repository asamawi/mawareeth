import importlib.util
import os
import re
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import ImproperlyConfigured
from django.core.management.commands import migrate
from django.db import OperationalError, connection, connections, migrations, models, transaction
from django.db.migrations.recorder import MigrationRecorder
from django.test import SimpleTestCase, TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse


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
        "MAILGUN_ACCESS_KEY": "dummy",
        "MAILGUN_SERVER_NAME": "dummy",
    }
    env.update(extra_env)

    with patch.dict(os.environ, env, clear=True):
        assert spec.loader is not None
        spec.loader.exec_module(module)
    return module


class ProductionSettingsTests(SimpleTestCase):
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
        # "require" is what Heroku Postgres supports today.
        for mode in ("disable", "require"):
            with self.subTest(mode=mode):
                module = load_settings_module({"DATABASE_SSL_MODE": mode})
                self.assertEqual(module.DATABASES["default"]["OPTIONS"]["sslmode"], mode)
                self.assertFalse(module.DEBUG)

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

    def test_missing_mailgun_credentials_raise(self):
        for name in ("MAILGUN_ACCESS_KEY", "MAILGUN_SERVER_NAME"):
            with self.subTest(name=name), self.assertRaisesRegex(ImproperlyConfigured, name):
                load_settings_module({name: ""})

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

    @override_settings(RELEASE_VERSION="build-2026-09-02", RELEASE_COMMIT_SHA="abc1234")
    def test_release_identity_endpoint_returns_expected_markers(self):
        response = self.client.get(reverse("ops-release"), secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
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


class WorkflowContractTests(SimpleTestCase):
    def test_validation_workflow_contains_required_release_gates(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "django.yml").read_text(encoding="utf-8")
        required_commands = [
            "python manage.py makemigrations --check --dry-run",
            "python manage.py migrate --noinput",
            "python manage.py collectstatic --noinput",
            "python manage.py check --deploy --fail-level WARNING",
            "python manage.py test",
        ]
        for command in required_commands:
            with self.subTest(command=command):
                executable_step = rf"- name: [^\n]+\n(?: +[^\n]+\n)*? +run: {re.escape(command)}(?:\n|$)"
                match = re.search(executable_step, workflow)
                self.assertIsNotNone(match)
                self.assertNotRegex(match.group(0), r"(?m)^ +if: false$")

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
        # edge mode, then the broken-copy self-test.
        self.assertEqual(caddy.count(validate), 3)
        self.assertEqual(caddy.count('-v "$PWD/deploy/caddy/edge:/etc/caddy/edge:ro"'), 3)
        self.assertIn("-e EDGE_MODE=cloudflare -e REDIRECT_DOMAIN=ci.example.com", caddy)
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

    def test_workflows_pin_third_party_actions(self):
        for name in ("deploy.yml", "django.yml"):
            workflow = (PROJECT_ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
            action_references = re.findall(r"(?m)^\s*(?:-\s+)?uses:\s*(\S+)", workflow)

            with self.subTest(workflow=name):
                self.assertTrue(action_references)
                self.assertEqual(len(action_references), workflow.count("uses:"))
            for reference in action_references:
                with self.subTest(workflow=name, reference=reference):
                    self.assertRegex(reference, r"^[^@]+@[0-9a-f]{40}$")
