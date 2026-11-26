import logging
import time

from django.conf import settings
from django.contrib.sessions.models import Session
from django.db import OperationalError, connection, transaction
from django.http import JsonResponse
from django.middleware.security import SecurityMiddleware
from django.urls import NoReverseMatch, reverse

from mawareeth import ops_views

HEALTH_VIEWS = {
    "/health/live/": ops_views.live,
    "/health/ready/": ops_views.ready,
    "/health/release/": ops_views.release,
}


class HealthCheckMiddleware:
    """Answer health probes before host validation and the HTTPS redirect.

    Inside the private Compose network, Caddy active checks, Docker
    healthchecks, and the deploy script reach a slot directly over plain HTTP
    using its container name or localhost as the Host header. Those requests
    would otherwise be rejected by ALLOWED_HOSTS (400) or redirected by
    SECURE_SSL_REDIRECT (301). Health responses never echo request data, so
    skipping those two controls for these exact read-only paths is safe.
    SecurityMiddleware's response headers (HSTS, nosniff, referrer and
    cross-origin policies) are still applied.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.security = SecurityMiddleware(get_response)

    def __call__(self, request):
        path = request.path_info
        # Probes may omit the trailing slash; APPEND_SLASH cannot help them
        # because its redirect runs after host validation.
        view = HEALTH_VIEWS.get(path if path.endswith("/") else f"{path}/")
        if view is not None and request.method in ("GET", "HEAD"):
            return self.security.process_response(request, view(request))
        return self.get_response(request)


logger = logging.getLogger("mawareeth.case_lock")
LOCK_NOT_AVAILABLE = "55P03"
_case_prefix = None
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def case_api_prefix():
    """The URL prefixes of session-case writes (the case API and saved cases), resolved on
    first use because URLs are not loaded at import.

    None when the active URLconf has no case API (a test URLconf), and then nothing is
    cached, so the real prefixes are found once the normal URLconf is back.
    """
    global _case_prefix
    if _case_prefix is None:
        try:
            _case_prefix = (reverse("api:case"), reverse("api:saved-cases"))
        except NoReverseMatch:
            return None
    return _case_prefix


class CaseWriteLockMiddleware:
    """Run each case write alone per visitor session.

    The anonymous case lives in the session, and Django saves the whole session
    dict, so two overlapping writes would each read the old case and the last
    save would win. This takes a row lock on the visitor's session before
    SessionMiddleware loads it, and holds it until after SessionMiddleware has
    saved it (the commit). It must therefore sit directly before
    SessionMiddleware. Safe methods, other paths and requests without a session
    cookie pass straight through.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        prefix = case_api_prefix() if request.method in UNSAFE_METHODS else None
        if prefix is None or not request.path_info.startswith(prefix):
            return self.get_response(request)
        key = request.COOKIES.get(settings.SESSION_COOKIE_NAME)
        if not key:
            return self.get_response(request)
        try:
            with transaction.atomic():
                # Read by the capacity harness through the test client's `wsgi_request`.
                self.lock(key, request)
                return self.get_response(request)
        except OperationalError as error:
            if is_lock_timeout(error):
                return busy_response()
            raise

    def lock(self, key, request=None):
        """Take the session row lock, waiting at most CASE_LOCK_TIMEOUT_MS.

        The wait limit is local to the transaction, so it also bounds the saved-case row lock
        taken later in the same request. Only the outcome and the wait are logged: never the
        session key, the case or the body.
        """
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute(f"SET LOCAL lock_timeout = '{int(settings.CASE_LOCK_TIMEOUT_MS)}ms'")
        started = time.monotonic()
        outcome = "acquired"
        try:
            # Evaluate the query: a lazy queryset would take no lock.
            list(Session.objects.select_for_update().filter(session_key=key).values_list("pk", flat=True))
        except OperationalError as error:
            if is_lock_timeout(error):
                outcome = "timeout"
            raise
        finally:
            wait_ms = int((time.monotonic() - started) * 1000)
            if request is not None:
                request.case_lock_wait_ms = wait_ms
            logger.log(
                logging.WARNING if outcome == "timeout" else logging.INFO,
                "case lock outcome=%s wait_ms=%d", outcome, wait_ms,
                extra={"outcome": outcome, "wait_ms": wait_ms})
        return wait_ms


def is_lock_timeout(error):
    """True when the database gave up waiting for a lock (SQLSTATE 55P03)."""
    cause = error.__cause__
    code = getattr(cause, "pgcode", None) or getattr(cause, "sqlstate", None)
    return code == LOCK_NOT_AVAILABLE


def busy_response():
    """A retryable 503: another request holds the case, and nothing was changed."""
    response = JsonResponse(
        {"error": "busy", "detail": "The case is busy. Try again.", "retryable": True}, status=503)
    response["Retry-After"] = "1"
    return response


FOUNDATION_ROUTES = frozenset("case case-preview case-deceased case-deaths case-death case-heirs case-heirs-bulk case-restore case-heir saved-cases saved-case-open saved-case-create share-view share-report received-view received-report report-draft".split())
foundation_logger = logging.getLogger("mawareeth.foundation")


def foundation_outcome(status, data, route):
    if 200 <= status < 300:
        state = data.get("status") if route == "case-preview" else None
        return {"unavailable": "refused", "choose_school": "choose_school", "not_ready": "not_ready"}.get(state, "ok")
    if status == 409:
        return "confirm" if data.get("error") == "cascade_unconfirmed" else "conflict"
    if status == 400:
        errors = data.get("errors", {})
        return "limit" if data.get("error") == "over_capacity" or (isinstance(errors, dict) and "limit" in errors.values()) else "invalid"
    if status == 503:
        return "busy" if data.get("error") == "busy" else "unavailable"
    return {401: "denied", 403: "denied", 404: "not_found", 410: "not_found", 429: "throttled"}.get(status, "error" if status >= 500 else "invalid")


class FoundationOutcomeMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from django.urls import resolve, Resolver404
        import json
        try:
            match = resolve(request.path_info)
        except Resolver404:
            return self.get_response(request)
        if match.namespace != "api" or match.url_name not in FOUNDATION_ROUTES:
            return self.get_response(request)
        started = time.perf_counter()
        status, outcome = 500, "error"
        try:
            response = self.get_response(request)
            status = response.status_code
            try:
                is_json = response.get("Content-Type", "").startswith("application/json")
                data = json.loads(response.content) if is_json and not response.streaming else {}
            except (ValueError, AttributeError):
                data = {}
            outcome = foundation_outcome(status, data if isinstance(data, dict) else {}, match.url_name)
            return response
        finally:
            latency = int((time.perf_counter() - started) * 1000)
            bucket = next((f"le_{n}" for n in (100, 250, 500, 1000) if latency <= n), "gt_1000")
            fields = dict(route=match.url_name, method=request.method, status=status, outcome=outcome, latency_ms=latency, bucket=bucket)
            foundation_logger.log(logging.WARNING if outcome in {"busy", "error", "unavailable"} else logging.INFO,
                "foundation route=%s method=%s status=%d outcome=%s latency_ms=%d bucket=%s",
                *fields.values(), extra=fields)
