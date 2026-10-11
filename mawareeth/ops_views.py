import logging

from django.conf import settings
from django.db import connections
from django.db.migrations.executor import MigrationExecutor
from django.http import JsonResponse
from django.views.decorators.cache import never_cache

logger = logging.getLogger(__name__)


def _database_ready():
    connection = connections["default"]
    connection.ensure_connection()
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        row = cursor.fetchone()
    return bool(row and row[0] == 1)


def _schema_ready():
    # Ready only when every migration this release ships has been applied.
    # Migrations applied by a newer release are ignored, so an older slot
    # stays ready across a compatible expand/migrate handover.
    executor = MigrationExecutor(connections["default"])
    targets = executor.loader.graph.leaf_nodes()
    return not executor.migration_plan(targets)


@never_cache
def live(request):
    return JsonResponse({"status": "ok", "service": "mawareeth"})


@never_cache
def ready(request):
    try:
        if not _database_ready():
            logger.warning("Readiness check failed: database did not answer SELECT 1.")
        elif not _schema_ready():
            logger.warning("Readiness check failed: unapplied migrations for this release.")
        else:
            return JsonResponse({"status": "ok", "database": "ok", "schema": "ok"})
    except Exception:
        # Readiness must remain safe for public probes: do not expose driver,
        # database, or configuration details when its dependency is unavailable.
        # The cause is logged server-side only.
        logger.exception("Readiness check failed.")
    return JsonResponse({"status": "error"}, status=503)


@never_cache
def release(request):
    payload = {
        "status": "ok",
        "version": settings.APP_VERSION,
        "release": settings.RELEASE_VERSION,
    }
    if settings.RELEASE_COMMIT_SHA:
        payload["commit"] = settings.RELEASE_COMMIT_SHA
    return JsonResponse(payload)
