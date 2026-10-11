#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


SCHEMA_VERSION = 1
REQUIRED_CONFIRMATIONS = (
    "target_app_confirmed",
    "database_reviewed",
    "addons_reviewed",
    "config_keys_reviewed",
    "domains_and_dns_reviewed",
)
APP_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*$")


class DiscoveryError(Exception):
    pass


class HerokuClient:
    def __init__(self, executable=None, executor=subprocess.run):
        self.executable = executable or shutil.which("heroku") or "heroku"
        self.executor = executor

    @staticmethod
    def build_command(executable, arguments, platform=os.name):
        if platform == "nt" and Path(executable).suffix.lower() in {".cmd", ".bat"}:
            executable_path = Path(executable)
            runtime_candidates = (
                (executable_path.parent / "node.exe", executable_path.parent / "run"),
                (
                    executable_path.parent.parent / "client" / "bin" / "node.exe",
                    executable_path.parent.parent / "client" / "bin" / "run",
                ),
            )
            for node, runner in runtime_candidates:
                if node.is_file() and runner.exists():
                    return [str(node), str(runner), *arguments]
            command_line = subprocess.list2cmdline([executable, *arguments])
            return [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/s", "/c", command_line]
        return [executable, *arguments]

    def _run(self, arguments):
        try:
            result = self.executor(
                self.build_command(self.executable, arguments),
                check=False,
                capture_output=True,
                text=True,
            )
        except OSError as exc:
            raise DiscoveryError("Heroku CLI is unavailable.") from exc
        if result.returncode != 0:
            raise DiscoveryError("Heroku command failed; authenticate and verify the app identifier.")
        return result.stdout

    def json(self, arguments):
        try:
            return json.loads(self._run([*arguments, "--json"]))
        except json.JSONDecodeError as exc:
            raise DiscoveryError("Heroku returned malformed JSON.") from exc

    def text(self, arguments):
        return self._run(arguments)

    def version(self):
        output = self._run(["version"])
        first_line = output.splitlines()[0].strip() if output.splitlines() else ""
        if not first_line:
            raise DiscoveryError("Heroku CLI version was unavailable.")
        return first_line


def _nested(value, *keys):
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _text(value):
    return value if isinstance(value, str) and value else None


def sanitize_app_info(raw):
    if not isinstance(raw, dict):
        raise DiscoveryError("App information has an unexpected shape.")
    if isinstance(raw.get("app"), dict):
        raw = raw["app"]
    return {
        "name": _text(raw.get("name")),
        "maintenance": raw.get("maintenance") if isinstance(raw.get("maintenance"), bool) else None,
        "region": _text(raw.get("region")) or _text(_nested(raw, "region", "name")),
        "stack": _text(raw.get("stack")) or _text(_nested(raw, "stack", "name")),
        "web_url": _text(raw.get("web_url")),
    }


def sanitize_processes(raw):
    if not isinstance(raw, list):
        raise DiscoveryError("Process information has an unexpected shape.")
    processes = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        process = {
            "command": _text(item.get("command")),
            "size": _text(item.get("size")),
            "state": _text(item.get("state")),
            "type": _text(item.get("type")) or _text(item.get("process_type")),
        }
        processes.append({key: value for key, value in process.items() if value is not None})
    return sorted(processes, key=lambda item: (item.get("type", ""), item.get("command", "")))


def sanitize_addons(raw):
    if not isinstance(raw, list):
        raise DiscoveryError("Add-on information has an unexpected shape.")
    addons = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        addon = {
            "name": _text(item.get("name")),
            "plan": _text(_nested(item, "plan", "name")) or _text(item.get("plan")),
            "service": _text(_nested(item, "addon_service", "name")) or _text(item.get("service")),
            "state": _text(item.get("state")),
        }
        addons.append({key: value for key, value in addon.items() if value is not None})
    return sorted(addons, key=lambda item: (item.get("service", ""), item.get("name", "")))


def sanitize_config_keys(raw):
    if not isinstance(raw, dict):
        raise DiscoveryError("Configuration information has an unexpected shape.")
    return sorted(str(key) for key in raw)


def sanitize_domains(raw):
    if not isinstance(raw, list):
        raise DiscoveryError("Domain information has an unexpected shape.")
    domains = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        domain = {
            "acm_status": _text(item.get("acm_status")),
            "cname": _text(item.get("cname")),
            "hostname": _text(item.get("hostname")),
            "kind": _text(item.get("kind")),
            "status": _text(item.get("status")),
        }
        domains.append({key: value for key, value in domain.items() if value is not None})
    return sorted(domains, key=lambda item: item.get("hostname", ""))


def sanitize_database(raw):
    if not isinstance(raw, dict):
        raise DiscoveryError("Database information has an unexpected shape.")
    safe_names = {
        "add-on", "addon", "attachments", "database", "pg version", "plan", "status", "version"
    }
    databases = []
    for attachment, details in raw.items():
        if not isinstance(details, dict):
            continue
        database = {"attachment": str(attachment)}
        for key, value in details.items():
            normalized_key = str(key).strip().lower()
            if normalized_key not in safe_names:
                continue
            if isinstance(value, (str, int, float, bool)) and value != "":
                database[normalized_key.replace(" ", "_")] = value
            elif isinstance(value, list):
                database[normalized_key.replace(" ", "_")] = sorted(
                    str(item) for item in value if isinstance(item, (str, int, float, bool))
                )
        databases.append(database)
    return sorted(databases, key=lambda item: item["attachment"])


def sanitize_database_text(raw):
    if not isinstance(raw, str):
        raise DiscoveryError("Database information has an unexpected shape.")
    safe_labels = {"add-on", "pg version", "plan", "status"}
    databases = []
    current = None
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith("=== "):
            attachments = [item.strip() for item in stripped[4:].split(",") if item.strip()]
            current = {"attachments": sorted(attachments)}
            databases.append(current)
            continue
        if current is None or ":" not in stripped:
            continue
        label, value = (part.strip() for part in stripped.split(":", 1))
        normalized_label = label.lower()
        if normalized_label in safe_labels and value:
            current[normalized_label.replace(" ", "_").replace("-", "_")] = value
    if not databases or any("plan" not in database or "pg_version" not in database for database in databases):
        raise DiscoveryError("Database information is incomplete.")
    return databases


def resolve_domain(hostname):
    try:
        records = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise DiscoveryError(f"DNS lookup failed for {hostname}.") from exc
    answers = {"A": [], "AAAA": []}
    for family, _socket_type, _protocol, _canonical_name, address in records:
        if family == socket.AF_INET:
            answers["A"].append(address[0])
        elif family == socket.AF_INET6:
            answers["AAAA"].append(address[0])
    answers = {record_type: sorted(set(values)) for record_type, values in answers.items() if values}
    if not answers:
        raise DiscoveryError(f"DNS lookup returned no records for {hostname}.")
    return answers


def capture_inventory(app, client=None, resolver=resolve_domain, captured_at=None):
    if not APP_PATTERN.fullmatch(app):
        raise DiscoveryError("The Heroku app identifier is invalid.")
    client = client or HerokuClient()
    captured_at = captured_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    report = {
        "schema_version": SCHEMA_VERSION,
        "captured_at": captured_at,
        "target_app": app,
        "tool_versions": {},
        "inventory": {},
        "unknown_sections": [],
        "confirmations": {name: False for name in REQUIRED_CONFIRMATIONS},
    }

    discoveries = (
        ("app", lambda: sanitize_app_info(client.json(["apps:info", "--app", app]))),
        ("processes", lambda: sanitize_processes(client.json(["ps", "--app", app]))),
        ("database", lambda: sanitize_database_text(client.text(["pg:info", "--app", app]))),
        ("addons", lambda: sanitize_addons(client.json(["addons", "--app", app]))),
        ("config_keys", lambda: sanitize_config_keys(client.json(["config", "--app", app]))),
        ("domains", lambda: sanitize_domains(client.json(["domains", "--app", app]))),
    )
    try:
        report["tool_versions"]["heroku"] = client.version()
    except DiscoveryError:
        report["unknown_sections"].append("tool_versions")

    for section, discover in discoveries:
        try:
            report["inventory"][section] = discover()
        except DiscoveryError:
            report["inventory"][section] = None
            report["unknown_sections"].append(section)

    dns_inventory = []
    domains = report["inventory"].get("domains")
    if domains is None:
        report["inventory"]["dns"] = None
        report["unknown_sections"].append("dns")
    else:
        for domain in domains:
            hostname = domain.get("hostname")
            if not hostname:
                continue
            try:
                dns_inventory.append({"hostname": hostname, "records": resolver(hostname)})
            except DiscoveryError:
                report["unknown_sections"].append(f"dns:{hostname}")
        report["inventory"]["dns"] = sorted(dns_inventory, key=lambda item: item["hostname"])

    for section in ("app", "processes", "database", "addons", "config_keys", "domains", "dns"):
        if report["inventory"].get(section) in (None, [], {}):
            report["unknown_sections"].append(section)
    report["unknown_sections"] = sorted(set(report["unknown_sections"]))
    return report


def verification_errors(report):
    errors = []
    if report.get("schema_version") != SCHEMA_VERSION:
        errors.append("schema_version")
    if report.get("unknown_sections"):
        errors.extend(f"unknown:{section}" for section in report["unknown_sections"])
    inventory = report.get("inventory")
    if not isinstance(inventory, dict):
        errors.append("inventory")
    else:
        for section in ("app", "processes", "database", "addons", "config_keys", "domains", "dns"):
            if inventory.get(section) in (None, [], {}):
                errors.append(f"missing:{section}")
    confirmations = report.get("confirmations")
    if not isinstance(confirmations, dict):
        errors.append("confirmations")
    else:
        for name in REQUIRED_CONFIRMATIONS:
            if confirmations.get(name) is not True:
                errors.append(f"confirmation:{name}")
    return sorted(set(errors))


def load_report(path):
    try:
        report = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DiscoveryError("The inventory report is missing or malformed.") from exc
    if not isinstance(report, dict):
        raise DiscoveryError("The inventory report has an unexpected shape.")
    return report


def write_report(path, report):
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8", newline="\n") as output:
        output.write(json.dumps(report, indent=2, sort_keys=True) + "\n")


def build_parser():
    parser = argparse.ArgumentParser(description="Capture and verify a redacted Heroku migration inventory.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    capture = subparsers.add_parser("capture")
    capture.add_argument("--app", required=True)
    capture.add_argument("--output", required=True)

    confirm = subparsers.add_parser("confirm")
    confirm.add_argument("--input", required=True)
    confirm.add_argument("--output")
    confirm.add_argument("--confirmation", action="append", choices=REQUIRED_CONFIRMATIONS, required=True)

    verify = subparsers.add_parser("verify")
    verify.add_argument("--input", required=True)
    return parser


def main(argv=None):
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "capture":
            report = capture_inventory(arguments.app)
            write_report(arguments.output, report)
            errors = verification_errors(report)
            print(f"Redacted inventory written to {arguments.output}.")
            if errors:
                print("Inventory is incomplete; review unknown sections and record confirmations.")
                return 2
            return 0
        if arguments.command == "confirm":
            report = load_report(arguments.input)
            confirmations = report.get("confirmations")
            if not isinstance(confirmations, dict):
                raise DiscoveryError("The inventory confirmations section is malformed.")
            for name in arguments.confirmation:
                confirmations[name] = True
            destination = arguments.output or arguments.input
            write_report(destination, report)
            print(f"Confirmations recorded in {destination}.")
            return 0
        report = load_report(arguments.input)
        errors = verification_errors(report)
        if errors:
            print("Inventory verification failed: " + ", ".join(errors))
            return 2
        print("Inventory verification passed.")
        return 0
    except DiscoveryError as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
