import contextlib
import io
import json
import re
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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
    return {"A": ["192.0.2.10"]}


def confirmed(report):
    report["confirmations"] = {name: True for name in heroku_inventory.REQUIRED_CONFIRMATIONS}
    return report


def run_main(argv, **kwargs):
    stdout, stderr = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        code = heroku_inventory.main(argv, **kwargs)
    return code, stdout.getvalue(), stderr.getvalue()


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

    def test_invalid_app_identifier_is_rejected(self):
        with self.assertRaisesRegex(heroku_inventory.DiscoveryError, "identifier is invalid"):
            heroku_inventory.capture_inventory("--app=other", FakeClient(), resolved_dns)

    def test_windows_shim_without_bundled_node_falls_back_to_quoted_cmd(self):
        with tempfile.TemporaryDirectory() as directory:
            shim = Path(directory) / "bin" / "heroku.cmd"
            arguments = ["apps:info", "--app", "mawareeth", "--json"]
            with mock.patch.dict("os.environ", {"COMSPEC": "C:\\Windows\\cmd.exe"}):
                command = heroku_inventory.HerokuClient.build_command(str(shim), arguments, platform="nt")

        self.assertEqual(command[:4], ["C:\\Windows\\cmd.exe", "/d", "/s", "/c"])
        self.assertEqual(command[4], subprocess.list2cmdline([str(shim), *arguments]))

    def test_client_runs_non_interactively_with_timeout_and_utf8(self):
        calls = []

        def executor(command, **kwargs):
            calls.append(kwargs)
            return subprocess.CompletedProcess(command, 0, "heroku/11.0.0 › extra\n", "")

        self.assertEqual(heroku_inventory.HerokuClient(executor=executor).version(), "heroku/11.0.0 › extra")
        self.assertIs(calls[0]["stdin"], subprocess.DEVNULL)
        self.assertEqual(calls[0]["encoding"], "utf-8")
        self.assertEqual(calls[0]["timeout"], heroku_inventory.COMMAND_TIMEOUT_SECONDS)

    def test_client_timeout_becomes_discovery_error(self):
        def executor(command, **kwargs):
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])

        with self.assertRaisesRegex(heroku_inventory.DiscoveryError, "timed out"):
            heroku_inventory.HerokuClient(executor=executor).text(["pg:info", "--app", "mawareeth"])

    def test_client_failures_give_remediation_without_echoing_stderr(self):
        cases = (
            ("Error: Invalid credentials provided. secret-token", "heroku login"),
            ("Couldn't find that app. secret-token", "not found"),
            ("unexpected secret-token", "authenticate and verify"),
        )
        for stderr, expected in cases:
            with self.subTest(stderr=stderr):
                client = heroku_inventory.HerokuClient(
                    executor=lambda command, **_kwargs: subprocess.CompletedProcess(command, 1, "", stderr)
                )
                with self.assertRaisesRegex(heroku_inventory.DiscoveryError, expected) as raised:
                    client.text(["pg:info", "--app", "mawareeth"])
                self.assertNotIn("secret-token", str(raised.exception))

    def test_responses_without_required_fields_are_unknown(self):
        app, responses, texts = complete_responses()
        responses[("apps:info", "--app", app)] = {"unexpected": True}
        responses[("ps", "--app", app)] = [{"unexpected": True}]
        responses[("addons", "--app", app)] = [{"unexpected": True}]
        responses[("domains", "--app", app)] = ["not-a-dict"]
        report = confirmed(
            heroku_inventory.capture_inventory(
                app, FakeClient(responses, texts), resolved_dns, "2026-10-11T00:00:00+00:00"
            )
        )

        self.assertEqual(report["unknown_sections"], ["addons", "app", "dns", "domains", "processes"])
        errors = heroku_inventory.verification_errors(report)
        for section in ("app", "processes", "addons", "domains", "dns"):
            self.assertIn(f"unknown:{section}", errors)

    def test_one_off_dynos_are_excluded(self):
        app, responses, texts = complete_responses()
        responses[("ps", "--app", app)].append(
            {"type": "run", "name": "run.1234", "command": "psql postgres://user:pw@host/db", "state": "up"}
        )
        report = heroku_inventory.capture_inventory(
            app, FakeClient(responses, texts), resolved_dns, "2026-10-11T00:00:00+00:00"
        )

        self.assertEqual([process["type"] for process in report["inventory"]["processes"]], ["web"])
        self.assertNotIn("pw@host", json.dumps(report))

    def test_process_command_with_inline_credential_is_not_written(self):
        for command in ("worker postgres://user:pw@host/db", "SECRET_KEY=abc gunicorn app"):
            with self.subTest(command=command):
                app, responses, texts = complete_responses()
                responses[("ps", "--app", app)] = [{"type": "worker", "command": command, "state": "up"}]
                errors = []
                report = heroku_inventory.capture_inventory(
                    app,
                    FakeClient(responses, texts),
                    resolved_dns,
                    "2026-10-11T00:00:00+00:00",
                    on_error=lambda section, message: errors.append(section),
                )

                self.assertIn("processes", report["unknown_sections"])
                self.assertEqual(errors, ["processes"])
                self.assertNotIn(command, json.dumps(report))

    def test_process_command_with_shell_default_is_kept(self):
        app, responses, texts = complete_responses()
        command = "gunicorn mawareeth.wsgi:application --bind 0.0.0.0:${PORT:-8000}"
        responses[("ps", "--app", app)] = [{"type": "web", "command": command, "state": "up"}]
        report = heroku_inventory.capture_inventory(
            app, FakeClient(responses, texts), resolved_dns, "2026-10-11T00:00:00+00:00"
        )

        self.assertEqual(report["inventory"]["processes"][0]["command"], command)

    def test_resolve_domain_groups_and_deduplicates_addresses(self):
        records = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.2", 0)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.1", 0)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.1", 0)),
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2001:db8::1", 0, 0, 0)),
        ]
        with mock.patch.object(heroku_inventory.socket, "getaddrinfo", return_value=records) as lookup:
            answers = heroku_inventory.resolve_domain("www.mawareeth.com")

        lookup.assert_called_once_with("www.mawareeth.com", None, type=socket.SOCK_STREAM)
        self.assertEqual(answers, {"A": ["192.0.2.1", "192.0.2.2"], "AAAA": ["2001:db8::1"]})

    def test_resolve_domain_fails_closed(self):
        with mock.patch.object(heroku_inventory.socket, "getaddrinfo", side_effect=socket.gaierror):
            with self.assertRaisesRegex(heroku_inventory.DiscoveryError, "lookup failed"):
                heroku_inventory.resolve_domain("missing.mawareeth.com")
        with mock.patch.object(heroku_inventory.socket, "getaddrinfo", return_value=[]):
            with self.assertRaisesRegex(heroku_inventory.DiscoveryError, "no records"):
                heroku_inventory.resolve_domain("empty.mawareeth.com")

    def test_resolve_wildcard_domain_uses_probe_label(self):
        records = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.3", 0))]
        with mock.patch.object(heroku_inventory.socket, "getaddrinfo", return_value=records) as lookup:
            answers = heroku_inventory.resolve_domain("*.mawareeth.com")

        self.assertEqual(lookup.call_args.args[0], "inventory-wildcard-probe.mawareeth.com")
        self.assertEqual(answers, {"A": ["192.0.2.3"]})

    def test_verification_requires_capture_metadata_and_matching_app(self):
        app, responses, texts = complete_responses()
        report = confirmed(
            heroku_inventory.capture_inventory(
                app, FakeClient(responses, texts), resolved_dns, "2026-10-11T00:00:00+00:00"
            )
        )
        report["tool_versions"] = {}
        report["captured_at"] = None
        report["target_app"] = "another-app"
        report["unknown_sections"] = "addons"

        self.assertEqual(
            heroku_inventory.verification_errors(report),
            ["app_name_mismatch", "missing:captured_at", "missing:tool_versions", "unknown_sections"],
        )

    def test_cli_capture_reports_missing_evidence_with_exit_2(self):
        app, responses, texts = complete_responses()
        client = FakeClient(responses, texts, failures={("addons", "--app", app)})
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            code, stdout, stderr = run_main(
                ["capture", "--app", app, "--output", str(output)], client=client, resolver=resolved_dns
            )

            self.assertEqual(code, 2)
            self.assertIn("unknown sections: addons", stdout)
            self.assertIn("addons: safe failure", stderr)
            self.assertIn("addons", heroku_inventory.load_report(output)["unknown_sections"])

    def test_cli_capture_confirm_and_verify_flow(self):
        app, responses, texts = complete_responses()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            code, stdout, _stderr = run_main(
                ["capture", "--app", app, "--output", str(output)],
                client=FakeClient(responses, texts),
                resolver=resolved_dns,
            )
            self.assertEqual(code, 3)
            self.assertIn("record the operator confirmations", stdout)

            partial = [arg for name in heroku_inventory.REQUIRED_CONFIRMATIONS[:-1] for arg in ("--confirmation", name)]
            self.assertEqual(run_main(["confirm", "--input", str(output), *partial])[0], 0)
            code, stdout, _stderr = run_main(["verify", "--input", str(output)])
            self.assertEqual(code, 2)
            self.assertIn("confirmation:domains_and_dns_reviewed", stdout)

            last = ["--confirmation", heroku_inventory.REQUIRED_CONFIRMATIONS[-1]]
            self.assertEqual(run_main(["confirm", "--input", str(output), *last])[0], 0)
            self.assertEqual(run_main(["verify", "--input", str(output)])[0], 0)
            self.assertEqual([path.name for path in Path(directory).iterdir()], ["inventory.json"])

    def test_cli_confirm_refuses_report_with_unknown_sections(self):
        app, responses, texts = complete_responses()
        report = heroku_inventory.capture_inventory(
            app, FakeClient(responses, texts, failures={("addons", "--app", app)}), resolved_dns, "t"
        )
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "inventory.json"
            heroku_inventory.write_report(output, report)
            code, _stdout, stderr = run_main(
                ["confirm", "--input", str(output), "--confirmation", "addons_reviewed"]
            )

            self.assertEqual(code, 2)
            self.assertIn("Resolve unknown sections", stderr)
            self.assertFalse(heroku_inventory.load_report(output)["confirmations"]["addons_reviewed"])


class CommittedBaselineTests(unittest.TestCase):
    baseline = Path(__file__).resolve().parents[2] / "docs" / "operations" / "heroku-inventory.redacted.json"

    def test_committed_baseline_verifies(self):
        report = heroku_inventory.load_report(self.baseline)
        self.assertEqual(heroku_inventory.verification_errors(report), [])

    def test_committed_baseline_contains_no_secret_material(self):
        text = self.baseline.read_text(encoding="utf-8")
        report = json.loads(text)

        self.assertIsNone(re.search(r"[A-Za-z][A-Za-z0-9+.-]*://[^/\s:@\"]+:[^@\s\"]+@", text))
        self.assertNotIn("-----BEGIN", text)
        self.assertTrue(all(re.fullmatch(r"[A-Z][A-Z0-9_]*", key) for key in report["inventory"]["config_keys"]))
        for process in report["inventory"]["processes"]:
            self.assertFalse(heroku_inventory._contains_secret(process["command"]))


if __name__ == "__main__":
    unittest.main()
