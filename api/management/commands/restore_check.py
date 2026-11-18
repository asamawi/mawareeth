from collections import Counter
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone
from api.models import SavedCase, ShareLink, ShareInvite
from api import snapshots
from mawareeth.ops_views import _schema_ready
from mawareeth.release_gates import catalogs


class Command(BaseCommand):
    requires_system_checks = []

    def handle(self, **options):
        try:
            self.check_restore()
        except Exception:
            # Database/setup failures must not expose driver details or credentials.
            self.stdout.write("failures=1")
            raise SystemExit(1)

    def check_restore(self):
        failed = 0
        try:
            assert _schema_ready()
            catalogs()
        except Exception:
            failed += 1
        versions = Counter()
        users = get_user_model().objects.values("pk")
        for row in SavedCase.objects.iterator():
            versions[row.schema_version] += 1
            try:
                assert row.schema_version in snapshots.READ_VERSIONS
                assert len(row.name) <= 100 and row.revision >= 1
                assert users.filter(pk=row.owner_id).exists()
                snapshots.decode(row.schema_version, row.snapshot, "check", "time")
            except Exception:
                failed += 1
                self.stdout.write(f"failed_saved_pk={row.pk}")
        for version, count in sorted(versions.items()):
            self.stdout.write(f"version={version} count={count}")
        now = timezone.now()
        for model in (ShareLink, ShareInvite):
            counts = Counter(active=0, revoked=0, expired=0)
            for row in model.objects.iterator():
                counts["revoked" if row.revoked_at else "expired" if row.expires_at <= now else "active"] += 1
                if not SavedCase.objects.filter(pk=row.saved_case_id).exists():
                    failed += 1
                if model is ShareInvite and row.accepted_at and (row.accepted_by_id is None or not users.filter(pk=row.accepted_by_id).exists()):
                    failed += 1
            self.stdout.write(model.__name__ + " " + " ".join(f"{key}={value}" for key, value in counts.items()))
        self.stdout.write(f"failures={failed}")
        if failed:
            raise SystemExit(1)
