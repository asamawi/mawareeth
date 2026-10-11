from django.middleware.security import SecurityMiddleware

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
