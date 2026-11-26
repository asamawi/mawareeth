"""Repeatable release-image capacity workloads; no saved-case writes."""
import base64
import gzip
import json
import math
import secrets
import threading
import time
from contextlib import ExitStack, contextmanager
from unittest.mock import patch
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.sessions.models import Session
from django.db import connection, connections
from django.test import Client

from api.throttling import CaseWriteThrottle, CasePreviewThrottle
from calc.adapters import family_from_session, basis_from_madhab
from presentation import outcome as evaluate_outcome
from engine.contracts.errors import ContractError
from engine.queries import placement_options
from engine.rule_set import school_rule_set
from engine.contracts.presented import parse_presented_result

NETWORK = dict(rtt_ms=150, down_kbps=1600, up_kbps=750, render_ms=100)
ENGINE_BUDGET_MS = 200
TOTAL_BUDGET_MS = 1000
WORKLOADS = ("standard_school", "standard_compare", "fifty_compare", "later_deaths_compare", "disagree_compare")
INTERVIEW_WORKLOADS = ("school", "compare", "two_later_deaths")
INTERVIEW_ACTIONS = ("add", "bulk_add", "edit", "delete", "drop", "undo")
INTERVIEW_BASE_HEIRS = 47
# Only the harness's Clients can bypass throttles while the patch is installed.
marker = secrets.token_hex(24)


class SetupError(Exception):
    pass


def stats(values, busy=0, conflicts=0, budget=None):
    ordered = sorted(values)
    percentile = lambda q: ordered[max(0, math.ceil(len(ordered)*q)-1)]
    return dict(n=len(values), p50=percentile(.5), p95=percentile(.95), max=max(values),
                busy=busy, conflicts=conflicts, passed=budget is None or percentile(.95) < budget)


class Harness:
    def __init__(self):
        self.keys = set()
        # The last request's timings, per thread: the contention writer shares this Harness.
        self.seen = threading.local()
        hosts = [h for h in settings.ALLOWED_HOSTS if h != "*"]
        self.host = hosts[0].lstrip(".") if hosts else "localhost"

    def client(self):
        client = Client(HTTP_HOST=self.host, HTTP_X_CAPACITY_CHECK=marker)
        # Register the key before any view runs, including views that raise after saving.
        self.keys.add(client.session.session_key)
        return client

    def request(self, client, method, path, data=None):
        # Measure actual application bytes (JSON body, query and request/response headers).
        payload = json.dumps(data, separators=(",", ":")) if data is not None else ""
        started = time.perf_counter()
        try:
            response = client.generic(method, path, payload, content_type="application/json", secure=True)
        finally:
            self.seen.request_ms = (time.perf_counter() - started) * 1000
            morsel = client.cookies.get(settings.SESSION_COOKIE_NAME)
            if morsel:
                self.keys.add(morsel.value)
        request = response.wsgi_request
        self.seen.lock_wait_ms = getattr(request, "case_lock_wait_ms", None)
        request_bytes = len(payload.encode()) + len((method + " " + path + " HTTP/1.1\r\n").encode())
        request_bytes += sum(len(str(k).encode()) + len(str(v).encode()) + 4 for k, v in request.headers.items()) + 2
        response_bytes = len(f"HTTP/1.1 {response.status_code} {response.reason_phrase}\r\n".encode())
        # The edge compresses responses (Caddyfile `encode zstd gzip`): count the body as gzip, the
        # more conservative of the two, at Caddy's default level 5.
        response_bytes += len(gzip.compress(response.content, 5)) + sum(len(k.encode())+len(v.encode())+4 for k,v in response.items()) + 2
        response_bytes += sum(len(m.OutputString().encode()) + 14 for m in response.cookies.values())
        return response, request_bytes, response_bytes

    def write(self, client, case, method, suffix, body):
        data = {**body, **({"case_id": case["id"], "expected_revision": case["revision"]} if case else {})}
        response, _, _ = self.request(client, method, "/api/v1/case/" + suffix, data)
        if response.status_code not in (200, 201):
            raise SetupError()
        return response.json()["case"]

    def build(self, name):
        client = self.client()
        case = self.write(client, None, "POST", "", {})
        case = self.write(client, case, "PUT", "deceased/", dict(gender="male", estate="120000"))
        if name == "standard_school":
            case = self.write(client, case, "PATCH", "", dict(madhab="hanbali"))
        relationships = (["wife"] + ["son"]*25 + ["daughter"]*24 if name == "fifty_compare" else
                         ["wife", "son"] if name == "later_deaths_compare" else
                         ["grandfather", "brother"] if name == "disagree_compare" else
                         ["wife", "father", "mother", "son", "daughter"])
        for relationship in relationships:
            case = self.write(client, case, "POST", "heirs/", dict(relationship=relationship))
        if name == "later_deaths_compare":
            son = next(r["id"] for r in case["heirs"] if r["relationship"] == "son")
            case = self.write(client, case, "POST", "deaths/", dict(heir_id=son))
            case = self.write(client, case, "POST", "heirs/", dict(relationship="son", layer=son))
            grandson = next(r["id"] for r in case["deaths"][0]["heirs"] if r["relationship"] == "son")
            case = self.write(client, case, "POST", "deaths/", dict(heir_id=grandson, first=son))
            case = self.write(client, case, "POST", "heirs/", dict(relationship="son", layer=grandson))
        return client, case

    def sample(self, client, case, value, expected_status="available", step=None):
        """Time one write plus the validated preview. `step(case)` is (method, path, body) for an
        Interview action; without it the write is the 8.11 estate-amount change."""
        started = time.perf_counter()
        counts = dict(busy=0, conflicts=0)
        # One record per attempt (retries and the cascade probe included): where the time went.
        attempts = counts["attempts"] = []
        up = down = 0
        confirm = False
        for attempt in range(200):
            method, path, data = step(case) if step else (
                "PUT", "/api/v1/case/deceased/", dict(gender="male", estate=str(value)))
            data = {**data, "case_id": case["id"], "expected_revision": case["revision"],
                    **({"confirm_cascade": True} if confirm else {})}
            if method == "DELETE":
                # A DELETE carries its input in the query string.
                path += "?" + urlencode({k: str(v).lower() if isinstance(v, bool) else v for k, v in data.items()})
                data = None
            response, sent, received = self.request(client, method, path, data)
            up += sent; down += received
            attempt = dict(kind="write", outcome="ok", status=response.status_code, write_ms=round(self.seen.request_ms, 2),
                                 lock_wait_ms=self.seen.lock_wait_ms, request_bytes=sent, response_bytes=received)
            attempts.append(attempt)
            if response.status_code == 409:
                body = response.json()
                attempt["outcome"] = "conflict"
                if method == "DELETE" and body.get("error") == "cascade_unconfirmed":
                    attempt["outcome"] = "cascade_probe"
                    # The cascade probe: confirm the exact impact, as the Interview's dialog does.
                    confirm = True
                    continue
                counts["conflicts"] += 1
                case = body["case"]
            elif response.status_code == 503 and response.json().get("error") == "busy":
                attempt["outcome"] = "busy"
                counts["busy"] += 1
            elif response.status_code in (200, 201):
                case = response.json()["case"]
                break
            else:
                raise SetupError()
        else:
            raise SetupError()
        for attempt in range(200):
            response, sent, received = self.request(client, "GET", "/api/v1/case/preview/?case_id=" + case["id"])
            up += sent; down += received
            attempt = dict(kind="preview", outcome="ok", status=response.status_code, preview_ms=round(self.seen.request_ms, 2),
                           validation_ms=0.0, lock_wait_ms=self.seen.lock_wait_ms,
                           request_bytes=sent, response_bytes=received)
            attempts.append(attempt)
            if response.status_code == 200:
                checked = time.perf_counter()
                try:
                    body = response.json()
                    if not isinstance(body, dict) or body.get("status") != expected_status:
                        raise SetupError()
                    revision = body.get("revision")
                    # The contention writer edits the same case, so a newer revision is a real
                    # answer; an older one would be stale numbers.
                    if type(revision) is not int or revision < max(1, case["revision"]):
                        raise SetupError()
                    parse_presented_result(body.get("presented"))
                except (ValueError, ContractError):
                    raise SetupError() from None
                finally:
                    attempt["validation_ms"] = round((time.perf_counter() - checked) * 1000, 2)
                break
            if response.status_code == 409:
                attempt["outcome"] = "conflict"
                counts["conflicts"] += 1
            elif response.status_code == 503 and response.json().get("error") == "busy":
                attempt["outcome"] = "busy"
                counts["busy"] += 1
            else:
                raise SetupError()
        else:
            raise SetupError()
        server = (time.perf_counter()-started)*1000
        model = 2*NETWORK["rtt_ms"] + up*8/NETWORK["up_kbps"] + down*8/NETWORK["down_kbps"] + NETWORK["render_ms"]
        return case, server + model, counts

    @contextmanager
    def contention(self, client, case, expected_status, enabled=True):
        """Run a second writer on the same Case, as the other deployment slot does during a handover."""
        stop = threading.Event()
        errors = []
        writer = self.client(); writer.cookies = client.cookies.copy()
        def compete():
            current = case
            try:
                while not stop.is_set():
                    current, _, _ = self.sample(writer, current, 120002, expected_status)
                    stop.wait(.002)
            except Exception:
                errors.append(True)
            finally:
                connections.close_all()
        thread = threading.Thread(target=compete, daemon=True)
        if enabled:
            thread.start()
        try:
            yield
        finally:
            stop.set()
            if enabled:
                thread.join(30)
                if thread.is_alive():
                    raise SetupError()
        if errors:
            raise SetupError()

    def command(self, client, case, method, suffix, body):
        """An untimed write that retries a conflict or busy answer; resets and seeding use it."""
        for _ in range(200):
            data = {**body, "case_id": case["id"], "expected_revision": case["revision"]}
            response, _, _ = self.request(client, method, "/api/v1/case/" + suffix, data)
            if response.status_code in (200, 201):
                return response.json()["case"]
            if response.status_code == 409:
                case = response.json()["case"]
            elif not (response.status_code == 503 and response.json().get("error") == "busy"):
                raise SetupError()
        raise SetupError()

    def build_interview(self, name):
        """A Case that the Interview actions take to at most 50 Heirs in the first estate."""
        client = self.client()
        case = self.write(client, None, "POST", "", {})
        case = self.write(client, case, "PUT", "deceased/", dict(gender="male", estate="120000"))
        if name == "school":
            case = self.write(client, case, "PATCH", "", dict(madhab="hanbali"))
            relationships = ["wife", "father", "mother", "son", "daughter"]
        else:
            relationships = ["wife"]
        rest = INTERVIEW_BASE_HEIRS - len(relationships)
        relationships += ["son"] * math.ceil(rest/2) + ["daughter"] * (rest//2)
        case = self.write(client, case, "POST", "heirs/bulk/", dict(heirs=[dict(relationship=r) for r in relationships]))
        if name == "two_later_deaths":
            son = next(r["id"] for r in case["heirs"] if r["relationship"] == "son")
            case = self.write(client, case, "POST", "deaths/", dict(heir_id=son))
            case = self.write(client, case, "POST", "heirs/", dict(relationship="son", layer=son))
            grandson = next(r["id"] for r in case["deaths"][0]["heirs"] if r["relationship"] == "son")
            case = self.write(client, case, "POST", "deaths/", dict(heir_id=grandson, first=son))
            case = self.write(client, case, "POST", "heirs/", dict(relationship="son", layer=grandson))
        if len(case["heirs"]) != INTERVIEW_BASE_HEIRS:
            raise SetupError()
        return client, case

    def interview_steps(self, name, case):
        """The timed write of each action, from the seeded Case; also its snapshot for resets and Undo."""
        snapshot = case["snapshot"]
        daughter = next(r["id"] for r in reversed(case["heirs"]) if r["relationship"] == "daughter")
        # The cascade probe needs someone whose removal drops a later estate.
        target = case["deaths"][0]["heir_id"] if name == "two_later_deaths" else daughter
        # Blocked-but-valid relatives stay addable, so a blocked place is a fair drop target. The
        # schema 1 writer refuses edges, so it only takes a drop onto the deceased.
        places = [(anchor, entry) for anchor, entries in case["placement"].items()
                  if (anchor == "root") == (settings.SNAPSHOT_WRITE_VERSION == 1) for entry in entries]
        drop = next(((a, e["relationship"]) for a, e in sorted(places, key=lambda p: p[1]["blocked"])), None)
        if drop is None:
            raise SetupError()
        base = "/api/v1/case/"
        # Undo uploads its snapshot gzipped+base64 (`snapshot_gz`), as the browser does, so the
        # harness measures the smaller request the Interview actually sends.
        snapshot_gz = base64.b64encode(
            gzip.compress(json.dumps(snapshot, separators=(",", ":")).encode(), 5)).decode()
        return dict(
            add=lambda c: ("POST", base + "heirs/", dict(relationship="son")),
            bulk_add=lambda c: ("POST", base + "heirs/bulk/", dict(heirs=[dict(relationship="daughter")]*3)),
            # Same gender: a person linked into a later estate keeps their gender, and the relationship still changes.
            edit=lambda c: ("PUT", base + "heirs/" + daughter + "/", dict(relationship="sister", name="Edited")),
            delete=lambda c: ("DELETE", base + "heirs/" + target + "/", {}),
            drop=lambda c: ("POST", base + "heirs/", dict(relationship=drop[1], anchor=drop[0])),
            undo=lambda c: ("POST", base + "restore/", dict(snapshot_gz=snapshot_gz)),
        ), snapshot

    def run_interview(self, samples, contention):
        """Time the six family actions through to a validated current-revision preview."""
        evidence = {}
        meta = {}
        for name in INTERVIEW_WORKLOADS:
            client, case = self.build_interview(name)
            steps, snapshot = self.interview_steps(name, case)
            meta[name] = dict(base_heirs=INTERVIEW_BASE_HEIRS, actions=list(INTERVIEW_ACTIONS),
                              later_deaths=len(case["deaths"]), school="hanbali" if name == "school" else "compare")
            evidence[name] = {}
            with self.contention(client, case, "available", contention):
                for action in INTERVIEW_ACTIONS:
                    values = []; busy = conflicts = 0; phases = []
                    for _ in range(samples):
                        # Resetting, and the change an Undo reverses, happen outside the timer.
                        case = self.command(client, case, "POST", "restore/", dict(snapshot=snapshot))
                        if action == "undo":
                            case = self.command(client, case, "POST", "heirs/", dict(relationship="son"))
                        case, duration, counts = self.sample(client, case, None, "available", steps[action])
                        values.append(duration); busy += counts["busy"]; conflicts += counts["conflicts"]
                        phases.append(counts["attempts"])
                    evidence[name][action] = dict(
                        stats(values, busy, conflicts, TOTAL_BUDGET_MS), samples_ms=[round(v, 2) for v in values],
                        attempts=phases)
        return evidence, meta

    def run(self, samples=20, contention=True, interview=False, device="model", network="model"):
        if connection.vendor != "postgresql" or samples < 1:
            raise SetupError()
        result = dict(commit=settings.RELEASE_COMMIT_SHA, model=NETWORK.copy(), device=device,
                      network=dict(label=network, **NETWORK), workloads={})
        try:
            with ExitStack() as stack:
                # Only these Clients bypass throttles; concurrent real requests keep their limits.
                for cls in (CaseWriteThrottle, CasePreviewThrottle):
                    original = cls.allow_request
                    stack.enter_context(patch.object(cls, "allow_request", lambda throttle, request, view, original=original:
                        True if request.META.get("HTTP_X_CAPACITY_CHECK") == marker else original(throttle, request, view)))
                for name in WORKLOADS:
                    client, case = self.build(name)
                    expected_status = "choose_school" if name == "disagree_compare" else "available"
                    family, _ = family_from_session(case, names=False)
                    basis = basis_from_madhab(case["madhab"])
                    durations = []
                    for _ in range(samples):
                        start = time.perf_counter(); evaluate_outcome(family, basis)
                        durations.append((time.perf_counter()-start)*1000)
                    engine = stats(durations, budget=ENGINE_BUDGET_MS if name.startswith("standard_") else None)
                    # The Interview's per-person placement query, on the same family and under the same budget.
                    rules = school_rule_set(case["madhab"] or "hanbali")
                    durations = []
                    for _ in range(samples):
                        start = time.perf_counter()
                        placement_options(family, rules, estate=1, deceased_gender=case["deceased"]["gender"])
                        durations.append((time.perf_counter()-start)*1000)
                    placement = stats(durations, budget=ENGINE_BUDGET_MS)
                    values = []; busy = conflicts = 0
                    with self.contention(client, case, expected_status, contention):
                        for index in range(samples):
                            case, duration, counts = self.sample(client, case, 120000 + index%2, expected_status)
                            values.append(duration); busy += counts["busy"]; conflicts += counts["conflicts"]
                    result["workloads"][name] = dict(engine=engine, placement=placement, end_to_end=stats(values, busy, conflicts, TOTAL_BUDGET_MS))
                if interview:
                    result["interview"], result["workload"] = self.run_interview(samples, contention)
            # Only the 8.11 workloads decide `passed`; the Interview mix is reported beside it.
            result["passed"] = all(phase["passed"] for workload in result["workloads"].values() for phase in workload.values())
            if "interview" in result:
                result["interview_passed"] = all(
                    phase["passed"] for workload in result["interview"].values() for phase in workload.values())
            return result
        finally:
            Session.objects.filter(session_key__in=self.keys).delete()
