import importlib.util
import os
import re
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, TestCase, override_settings
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
        module = load_settings_module({"DATABASE_SSL_MODE": "require"})
        self.assertEqual(module.DATABASES["default"]["OPTIONS"]["sslmode"], "require")
        self.assertFalse(module.DEBUG)


class OpsEndpointTests(TestCase):
    def test_liveness_endpoint_returns_ok(self):
        response = self.client.get(reverse("ops-live"), secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(response.content, {"status": "ok", "service": "mawareeth"})

    def test_readiness_endpoint_returns_ok(self):
        response = self.client.get(reverse("ops-ready"), secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(response.content, {"status": "ok", "database": "ok"})

    def test_readiness_endpoint_returns_503_without_diagnostics(self):
        with patch("mawareeth.ops_views._database_ready", return_value=False):
            response = self.client.get(reverse("ops-ready"), secure=True)
        self.assertEqual(response.status_code, 503)
        self.assertJSONEqual(response.content, {"status": "error"})

    def test_readiness_endpoint_hides_database_exception(self):
        with patch("mawareeth.ops_views._database_ready", side_effect=RuntimeError("password leaked")):
            response = self.client.get(reverse("ops-ready"), secure=True)
        self.assertEqual(response.status_code, 503)
        self.assertJSONEqual(response.content, {"status": "error"})

    @override_settings(RELEASE_VERSION="build-2026-09-02", RELEASE_COMMIT_SHA="abc1234")
    def test_release_identity_endpoint_returns_expected_markers(self):
        response = self.client.get(reverse("ops-release"), secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["release"], "build-2026-09-02")
        self.assertEqual(response.json()["commit"], "abc1234")


class WorkflowContractTests(SimpleTestCase):
    def test_validation_workflow_contains_required_release_gates(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "django.yml").read_text(encoding="utf-8")
        required_commands = [
            "python manage.py makemigrations --check --dry-run",
            "python manage.py migrate --noinput",
            "python manage.py collectstatic --noinput",
            "python manage.py check --deploy",
            "python manage.py test",
        ]
        for command in required_commands:
            with self.subTest(command=command):
                executable_step = rf"- name: [^\n]+\n(?: +[^\n]+\n)*? +run: {re.escape(command)}(?:\n|$)"
                match = re.search(executable_step, workflow)
                self.assertIsNotNone(match)
                self.assertNotRegex(match.group(0), r"(?m)^ +if: false$")

    def test_publish_workflow_builds_image_after_validation(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        required_snippets = [
            "workflow_run:",
            "Django CI",
            "docker/build-push-action",
            "push: true",
            "release-metadata.json",
            "steps.build.outputs.digest",
            "build-args:",
            "RELEASE_VERSION=${{ github.event.workflow_run.head_sha }}",
            "RELEASE_COMMIT_SHA=${{ github.event.workflow_run.head_sha }}",
        ]
        for snippet in required_snippets:
            with self.subTest(snippet=snippet):
                self.assertIn(snippet, workflow)
