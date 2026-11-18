from django.core.management.base import BaseCommand
from mawareeth.release_gates import gates


class Command(BaseCommand):
    requires_system_checks = []

    def handle(self, **options):
        failed = []
        for name, gate in gates().items():
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
