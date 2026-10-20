import logging

from django.conf import settings
from django.db import connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.http import JsonResponse
from django.views.decorators.cache import never_cache

logger = logging.getLogger(__name__)

# A stalled or locked database must fail the probe quickly (Caddy's active
# health check gives up after 3s) instead of pinning a gunicorn worker until
# gunicorn's 60s timeout. Both limits apply per statement, not to the probe as
# a whole, and do not cover connecting (DATABASE_CONNECT_TIMEOUT does).
READINESS_DB_TIMEOUT = "2s"


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


def _checks_pass():
    if not _database_ready():
        logger.warning("Readiness check failed: database did not answer SELECT 1.")
        return False
    if not _schema_ready():
        logger.warning("Readiness check failed: unapplied migrations for this release.")
        return False
    return True


def _readiness_checks():
    connection = connections["default"]
    if connection.vendor != "postgresql" or connection.in_atomic_block:
        # Inside an outer atomic block the probe's atomic() would only be a
        # savepoint, and SET LOCAL would outlive it until the outer transaction
        # ends, so the timeouts are applied only in the probe's own transaction.
        return _checks_pass()
    # SET LOCAL lasts only until this transaction ends, so pooled connections
    # (conn_max_age) keep their session defaults for ordinary requests.
    # The timeouts bound each statement; connect_timeout bounds connecting.
    with transaction.atomic(using="default"):
        with connection.cursor() as cursor:
            cursor.execute(f"SET LOCAL statement_timeout = '{READINESS_DB_TIMEOUT}'")
            cursor.execute(f"SET LOCAL lock_timeout = '{READINESS_DB_TIMEOUT}'")
        return _checks_pass()


@never_cache
def live(request):
    return JsonResponse({"status": "ok", "service": "mawareeth"})


# Kept out of ATOMIC_REQUESTS so the probe's own transaction, and its SET LOCAL
# timeouts, still apply if that setting is ever enabled.
@transaction.non_atomic_requests
@never_cache
def ready(request):
    try:
        if _readiness_checks():
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
