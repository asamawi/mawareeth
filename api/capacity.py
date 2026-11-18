"""Repeatable release-image capacity workloads; no saved-case writes."""
import gzip
import json
import math
import secrets
import threading
import time
from contextlib import ExitStack
from unittest.mock import patch

from django.conf import settings
from django.contrib.sessions.models import Session
from django.db import connection, connections
from django.test import Client

from api.throttling import CaseWriteThrottle, CasePreviewThrottle
from calc.adapters import family_from_session, basis_from_madhab
from presentation import outcome as evaluate_outcome
from engine.contracts.errors import ContractError
from engine.contracts.presented import parse_presented_result

NETWORK = dict(rtt_ms=150, down_kbps=1600, up_kbps=750, render_ms=100)
ENGINE_BUDGET_MS = 200
TOTAL_BUDGET_MS = 1000
WORKLOADS = ("standard_school", "standard_compare", "fifty_compare", "later_deaths_compare", "disagree_compare")
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
        try:
            response = client.generic(method, path, payload, content_type="application/json", secure=True)
        finally:
            morsel = client.cookies.get(settings.SESSION_COOKIE_NAME)
            if morsel:
                self.keys.add(morsel.value)
        request = response.wsgi_request
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

    def sample(self, client, case, value, expected_status="available"):
        started = time.perf_counter()
        counts = dict(busy=0, conflicts=0)
        up = down = 0
        for attempt in range(200):
            response, sent, received = self.request(client, "PUT", "/api/v1/case/deceased/",
                dict(case_id=case["id"], expected_revision=case["revision"], gender="male", estate=str(value)))
            up += sent; down += received
            if response.status_code == 409:
                counts["conflicts"] += 1
                case = response.json()["case"]
            elif response.status_code == 503 and response.json().get("error") == "busy":
                counts["busy"] += 1
            elif response.status_code == 200:
                case = response.json()["case"]
                break
            else:
                raise SetupError()
        else:
            raise SetupError()
        for attempt in range(200):
            response, sent, received = self.request(client, "GET", "/api/v1/case/preview/?case_id=" + case["id"])
            up += sent; down += received
            if response.status_code == 200:
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
                break
            if response.status_code == 409:
                counts["conflicts"] += 1
            elif response.status_code == 503 and response.json().get("error") == "busy":
                counts["busy"] += 1
            else:
                raise SetupError()
        else:
            raise SetupError()
        server = (time.perf_counter()-started)*1000
        model = 2*NETWORK["rtt_ms"] + up*8/NETWORK["up_kbps"] + down*8/NETWORK["down_kbps"] + NETWORK["render_ms"]
        return case, server + model, counts

    def run(self, samples=20, contention=True):
        if connection.vendor != "postgresql" or samples < 1:
            raise SetupError()
        result = dict(commit=settings.RELEASE_COMMIT_SHA, model=NETWORK.copy(), workloads={})
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
                    values = []; busy = conflicts = 0
                    if contention:
                        thread.start()
                    try:
                        for index in range(samples):
                            case, duration, counts = self.sample(client, case, 120000 + index%2, expected_status)
                            values.append(duration); busy += counts["busy"]; conflicts += counts["conflicts"]
                    finally:
                        stop.set()
                        if contention:
                            thread.join(30)
                            if thread.is_alive():
                                raise SetupError()
                    if errors:
                        raise SetupError()
                    result["workloads"][name] = dict(engine=engine, end_to_end=stats(values, busy, conflicts, TOTAL_BUDGET_MS))
            result["passed"] = all(phase["passed"] for workload in result["workloads"].values() for phase in workload.values())
            return result
        finally:
            Session.objects.filter(session_key__in=self.keys).delete()
