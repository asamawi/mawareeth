import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from deploy import heroku_inventory


class FakeClient:
    def __init__(self, responses=None, texts=None, failures=None):
        self.responses = responses or {}
        self.texts = texts or {}
        self.failures = set(failures or [])

    def json(self, arguments):
        key = tuple(arguments)
        if key in self.failures:
            raise heroku_inventory.DiscoveryError("safe failure")
        return self.responses[key]

    def text(self, arguments):
        key = tuple(arguments)
        if key in self.failures:
            raise heroku_inventory.DiscoveryError("safe failure")
        return self.texts[key]

    def version(self):
        if ("version",) in self.failures:
            raise heroku_inventory.DiscoveryError("safe failure")
        return "heroku/10.0.0"


def complete_responses(secret="super-secret-value"):
    app = "mawareeth-production"
    responses = {
        ("apps:info", "--app", app): {
            "name": app,
            "maintenance": False,
            "region": {"name": "eu"},
            "stack": {"name": "heroku-24"},
            "web_url": "https://www.mawareeth.com/",
            "git_url": "ignored",
        },
        ("ps", "--app", app): [
            {"type": "web", "command": "gunicorn mawareeth.wsgi", "size": "basic", "state": "up"}
        ],
        ("addons", "--app", app): [
            {
                "name": "postgresql-shaped-name",
                "addon_service": {"name": "heroku-postgresql"},
                "plan": {"name": "essential-0"},
                "state": "provisioned",
            }
        ],
        ("config", "--app", app): {"DJANGO_KEY": secret, "DATABASE_URL": f"postgres://{secret}"},
        ("domains", "--app", app): [
            {"hostname": "www.mawareeth.com", "kind": "custom", "status": "succeeded"}
        ],
    }
    texts = {
        ("pg:info", "--app", app): """=== DATABASE_URL
Plan: essential-0
Status: Available
PG Version: 17
Data Size: ignored
URL: postgres://user:super-secret-value@host/db
Add-on: postgresql-shaped-name
"""
    }
    return app, responses, texts


def resolved_dns(hostname):
    return {"CNAME": ["example.herokudns.com"], "A": ["192.0.2.10"]}


class InventoryTests(unittest.TestCase):
    def test_windows_heroku_shim_uses_bundled_node_without_shell_expansion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shim = root / "bin" / "heroku.cmd"
            node = root / "client" / "bin" / "node.exe"
            runner = root / "client" / "bin" / "run"
            shim.parent.mkdir(parents=True)
            node.parent.mkdir(parents=True)
            shim.touch()
            node.touch()
            runner.touch()

            command = heroku_inventory.HerokuClient.build_command(
                str(shim), ["apps:info", "--app", "mawareeth", "--json"], platform="nt"
            )

        self.assertEqual(command[:2], [str(node), str(runner)])
        self.assertEqual(command[2:], ["apps:info", "--app", "mawareeth", "--json"])

    def test_complete_capture_is_redacted_and_deterministic(self):
        app, responses, texts = complete_responses()
        first = heroku_inventory.capture_inventory(
            app, FakeClient(responses, texts), resolved_dns, "2026-10-11T00:00:00+00:00"
        )
        second = heroku_inventory.capture_inventory(
            app, FakeClient(responses, texts), resolved_dns, "2026-10-11T00:00:00+00:00"
        )

        self.assertEqual(first, second)
        serialized = json.dumps(first, sort_keys=True)
        self.assertNotIn("super-secret-value", serialized)
        self.assertNotIn("postgres://", serialized)
        self.assertEqual(first["inventory"]["config_keys"], ["DATABASE_URL", "DJANGO_KEY"])
        self.assertEqual(first["unknown_sections"], [])

    def test_partial_discovery_fails_closed_without_exposing_command_output(self):
        app, responses, texts = complete_responses()
        failed_command = ("addons", "--app", app)
        report = heroku_inventory.capture_inventory(
            app,
            FakeClient(responses, texts, failures={failed_command}),
            resolved_dns,
            "2026-10-11T00:00:00+00:00",
        )

        self.assertIn("addons", report["unknown_sections"])
        self.assertIn("unknown:addons", heroku_inventory.verification_errors(report))
        self.assertNotIn("safe failure", json.dumps(report))

    def test_unresolved_dns_blocks_verification(self):
        app, responses, texts = complete_responses()

        def unresolved(_hostname):
            raise heroku_inventory.DiscoveryError("DNS lookup failed")

        report = heroku_inventory.capture_inventory(
            app, FakeClient(responses, texts), unresolved, "2026-10-11T00:00:00+00:00"
        )

        self.assertIn("dns:www.mawareeth.com", report["unknown_sections"])
        self.assertIn("missing:dns", heroku_inventory.verification_errors(report))

    def test_verification_requires_every_operator_confirmation(self):
        app, responses, texts = complete_responses()
        report = heroku_inventory.capture_inventory(
            app, FakeClient(responses, texts), resolved_dns, "2026-10-11T00:00:00+00:00"
        )
        self.assertTrue(
            any(error.startswith("confirmation:") for error in heroku_inventory.verification_errors(report))
        )

        report["confirmations"] = {name: True for name in heroku_inventory.REQUIRED_CONFIRMATIONS}
        self.assertEqual(heroku_inventory.verification_errors(report), [])

    def test_malformed_json_is_reported_without_raw_output(self):
        def executor(_command, **_kwargs):
            return subprocess.CompletedProcess([], 0, "not-json secret-value", "")

        client = heroku_inventory.HerokuClient(executor=executor)
        with self.assertRaisesRegex(heroku_inventory.DiscoveryError, "malformed JSON") as raised:
            client.json(["apps:info", "--app", "mawareeth-production"])
        self.assertNotIn("secret-value", str(raised.exception))

    def test_cli_capture_writes_partial_report_and_returns_nonzero(self):
        app, responses, texts = complete_responses()
        report = heroku_inventory.capture_inventory(
            app, FakeClient(responses, texts), resolved_dns, "2026-10-11T00:00:00+00:00"
        )
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            heroku_inventory.write_report(output, report)
            self.assertTrue(output.exists())
            self.assertTrue(heroku_inventory.verification_errors(heroku_inventory.load_report(output)))

    def test_invalid_app_identifier_is_rejected(self):
        with self.assertRaisesRegex(heroku_inventory.DiscoveryError, "identifier is invalid"):
            heroku_inventory.capture_inventory("--app=other", FakeClient(), resolved_dns)


if __name__ == "__main__":
    unittest.main()
