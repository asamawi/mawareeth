from django.conf import settings
from django.contrib.sessions.models import Session
from django.db import transaction
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


_case_prefix = None
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def case_api_prefix():
    """The case API's URL prefix, resolved on first use because URLs are not loaded at import.

    None when the active URLconf has no case API (a test URLconf), and then nothing is
    cached, so the real prefix is found once the normal URLconf is back.
    """
    global _case_prefix
    if _case_prefix is None:
        try:
            _case_prefix = reverse("api:case")
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
        with transaction.atomic():
            self.lock(key)
            return self.get_response(request)

    def lock(self, key):
        # Evaluate the query: a lazy queryset would take no lock.
        list(Session.objects.select_for_update().filter(session_key=key).values_list("pk", flat=True))
