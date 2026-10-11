from django.conf import settings
from django.db import connections
from django.http import JsonResponse


def _database_ready():
    connection = connections["default"]
    connection.ensure_connection()
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        row = cursor.fetchone()
    return bool(row and row[0] == 1)


def live(request):
    return JsonResponse({"status": "ok", "service": "mawareeth"})


def ready(request):
    try:
        if _database_ready():
            return JsonResponse({"status": "ok", "database": "ok"})
    except Exception:
        # Readiness must remain safe for public probes: do not expose driver,
        # database, or configuration details when its dependency is unavailable.
        pass
    return JsonResponse({"status": "error"}, status=503)


def release(request):
    payload = {
        "status": "ok",
        "version": settings.APP_VERSION,
        "release": settings.RELEASE_VERSION,
    }
    if settings.RELEASE_COMMIT_SHA:
        payload["commit"] = settings.RELEASE_COMMIT_SHA
    return JsonResponse(payload)
