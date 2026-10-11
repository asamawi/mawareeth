#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
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
REQUIRED_SECTIONS = ("app", "processes", "database", "addons", "config_keys", "domains", "dns")
APP_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*$")
COMMAND_TIMEOUT_SECONDS = 60
WILDCARD_PROBE_LABEL = "inventory-wildcard-probe"
# Process commands are persisted verbatim, so reject anything that looks like an inline credential.
SECRET_PATTERNS = (
    re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://[^/\s:@]+:[^@\s]+@"),
    re.compile(r"(?<![A-Za-z0-9_{:-])[A-Z][A-Z0-9_]*=\S"),
)


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

    @staticmethod
    def classify_failure(stderr):
        # Only a fixed remediation message is returned; CLI output is never echoed.
        message = (stderr or "").lower()
        if any(marker in message for marker in ("credentials", "logged in", "login", "unauthorized")):
            return "Heroku authentication failed; run `heroku login` and retry."
        if any(marker in message for marker in ("couldn't find that app", "not found", "do not have access")):
            return "Heroku app was not found or is not accessible; verify the app identifier and account access."
        return "Heroku command failed; authenticate and verify the app identifier."

    def _run(self, arguments):
        try:
            result = self.executor(
                self.build_command(self.executable, arguments),
                check=False,
                capture_output=True,
                stdin=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=COMMAND_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise DiscoveryError("Heroku command timed out.") from exc
        except OSError as exc:
            raise DiscoveryError("Heroku CLI is unavailable.") from exc
        if result.returncode != 0:
            raise DiscoveryError(self.classify_failure(result.stderr))
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


def _require_dicts(raw, label):
    if not isinstance(raw, list):
        raise DiscoveryError(f"{label} information has an unexpected shape.")
    if any(not isinstance(item, dict) for item in raw):
        raise DiscoveryError(f"{label} information contains an unexpected item.")
    return raw


def _contains_secret(value):
    return any(pattern.search(value) for pattern in SECRET_PATTERNS)


def sanitize_app_info(raw):
    if not isinstance(raw, dict):
        raise DiscoveryError("App information has an unexpected shape.")
    if isinstance(raw.get("app"), dict):
        raw = raw["app"]
    app = {
        "name": _text(raw.get("name")),
        "maintenance": raw.get("maintenance") if isinstance(raw.get("maintenance"), bool) else None,
        "region": _text(raw.get("region")) or _text(_nested(raw, "region", "name")),
        "stack": _text(raw.get("stack")) or _text(_nested(raw, "stack", "name")),
        "web_url": _text(raw.get("web_url")),
    }
    if app["name"] is None:
        raise DiscoveryError("App information is incomplete.")
    return app


def sanitize_processes(raw):
    processes = []
    for item in _require_dicts(raw, "Process"):
        process_type = _text(item.get("type")) or _text(item.get("process_type"))
        # One-off dynos carry operator-typed commands and are not part of the process model.
        if process_type == "run" or (_text(item.get("name")) or "").startswith("run."):
            continue
        process = {
            "command": _text(item.get("command")),
            "size": _text(item.get("size")),
            "state": _text(item.get("state")),
            "type": process_type,
        }
        if process["type"] is None or process["command"] is None:
            raise DiscoveryError("Process information is incomplete.")
        if _contains_secret(process["command"]):
            raise DiscoveryError("A process command appears to contain a credential; review it manually.")
        processes.append({key: value for key, value in process.items() if value is not None})
    return sorted(processes, key=lambda item: (item["type"], item["command"]))


def sanitize_addons(raw):
    addons = []
    for item in _require_dicts(raw, "Add-on"):
        addon = {
            "name": _text(item.get("name")),
            "plan": _text(_nested(item, "plan", "name")) or _text(item.get("plan")),
            "service": _text(_nested(item, "addon_service", "name")) or _text(item.get("service")),
            "state": _text(item.get("state")),
        }
        if addon["name"] is None or (addon["service"] is None and addon["plan"] is None):
            raise DiscoveryError("Add-on information is incomplete.")
        addons.append({key: value for key, value in addon.items() if value is not None})
    return sorted(addons, key=lambda item: (item.get("service", ""), item["name"]))


def sanitize_config_keys(raw):
    if not isinstance(raw, dict):
        raise DiscoveryError("Configuration information has an unexpected shape.")
    return sorted(str(key) for key in raw)


def sanitize_domains(raw):
    domains = []
    for item in _require_dicts(raw, "Domain"):
        domain = {
            "acm_status": _text(item.get("acm_status")),
            "cname": _text(item.get("cname")),
            "hostname": _text(item.get("hostname")),
            "kind": _text(item.get("kind")),
            "status": _text(item.get("status")),
        }
        if domain["hostname"] is None:
            raise DiscoveryError("Domain information is incomplete.")
        domains.append({key: value for key, value in domain.items() if value is not None})
    return sorted(domains, key=lambda item: item["hostname"])


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
    # A wildcard domain cannot be looked up directly; resolve a probe label it covers instead.
    lookup = f"{WILDCARD_PROBE_LABEL}.{hostname[2:]}" if hostname.startswith("*.") else hostname
    try:
        records = socket.getaddrinfo(lookup, None, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError) as exc:
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


def capture_inventory(app, client=None, resolver=resolve_domain, captured_at=None, on_error=None):
    if not APP_PATTERN.fullmatch(app):
        raise DiscoveryError("The Heroku app identifier is invalid.")
    client = client or HerokuClient()
    captured_at = captured_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    report_error = on_error or (lambda _section, _message: None)
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
    except DiscoveryError as exc:
        report["unknown_sections"].append("tool_versions")
        report_error("tool_versions", str(exc))

    for section, discover in discoveries:
        try:
            report["inventory"][section] = discover()
        except DiscoveryError as exc:
            report["inventory"][section] = None
            report["unknown_sections"].append(section)
            report_error(section, str(exc))

    dns_inventory = []
    domains = report["inventory"].get("domains")
    if domains is None:
        report["inventory"]["dns"] = None
        report["unknown_sections"].append("dns")
    else:
        for domain in domains:
            hostname = domain["hostname"]
            try:
                dns_inventory.append({"hostname": hostname, "records": resolver(hostname)})
            except DiscoveryError as exc:
                report["unknown_sections"].append(f"dns:{hostname}")
                report_error(f"dns:{hostname}", str(exc))
        report["inventory"]["dns"] = sorted(dns_inventory, key=lambda item: item["hostname"])

    for section in REQUIRED_SECTIONS:
        if report["inventory"].get(section) in (None, [], {}):
            report["unknown_sections"].append(section)
    report["unknown_sections"] = sorted(set(report["unknown_sections"]))
    return report


def verification_errors(report):
    errors = []
    if report.get("schema_version") != SCHEMA_VERSION:
        errors.append("schema_version")
    if not _text(report.get("captured_at")):
        errors.append("missing:captured_at")
    if not _text(_nested(report, "tool_versions", "heroku")):
        errors.append("missing:tool_versions")
    unknown_sections = report.get("unknown_sections")
    if not isinstance(unknown_sections, list):
        errors.append("unknown_sections")
    else:
        errors.extend(f"unknown:{section}" for section in unknown_sections)
    inventory = report.get("inventory")
    if not isinstance(inventory, dict):
        errors.append("inventory")
    else:
        for section in REQUIRED_SECTIONS:
            if inventory.get(section) in (None, [], {}):
                errors.append(f"missing:{section}")
        app_name = _nested(inventory, "app", "name")
        if app_name is not None and app_name != report.get("target_app"):
            errors.append("app_name_mismatch")
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
    # Write beside the destination and swap in place so an interrupted write never truncates a reviewed report.
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="\n", dir=destination.parent, prefix=f".{destination.name}.", delete=False
    ) as output:
        output.write(json.dumps(report, indent=2, sort_keys=True) + "\n")
    try:
        os.replace(output.name, destination)
    except OSError:
        os.unlink(output.name)
        raise


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


def _print_error(section, message):
    print(f"{section}: {message}", file=sys.stderr)


def main(argv=None, client=None, resolver=resolve_domain):
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "capture":
            report = capture_inventory(arguments.app, client, resolver, on_error=_print_error)
            write_report(arguments.output, report)
            print(f"Redacted inventory written to {arguments.output}.")
            if report["unknown_sections"]:
                print("Inventory is incomplete; unknown sections: " + ", ".join(report["unknown_sections"]))
                return 2
            print("Inventory captured; review every section and record the operator confirmations.")
            return 3
        if arguments.command == "confirm":
            report = load_report(arguments.input)
            confirmations = report.get("confirmations")
            if not isinstance(confirmations, dict):
                raise DiscoveryError("The inventory confirmations section is malformed.")
            if report.get("unknown_sections") != []:
                raise DiscoveryError("Resolve unknown sections by recapturing before recording confirmations.")
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
    except (DiscoveryError, OSError) as exc:
        print(str(exc) if isinstance(exc, DiscoveryError) else "The inventory report could not be written.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
