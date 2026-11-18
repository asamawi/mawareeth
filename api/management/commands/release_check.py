from django.core.management.base import BaseCommand
from mawareeth.release_gates import gates, rollback


class Command(BaseCommand):
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("--rollback-reads", help="Comma-separated snapshot versions read by the rollback target")

    def handle(self, **options):
        failed = []
        checks = gates()
        reads = options["rollback_reads"]
        if reads is None:
            self.stdout.write("rollback reader check skipped: --rollback-reads not provided")
        else:
            checks["rollback"] = lambda: rollback(reads)
        for name, gate in checks.items():
            try:
                notice = gate()
                if notice:
                    self.stdout.write(notice)
            except Exception:
                failed.append(name)
        if failed:
            self.stdout.write("failed: " + " ".join(failed))
            raise SystemExit(1)
        self.stdout.write("release checks passed")
