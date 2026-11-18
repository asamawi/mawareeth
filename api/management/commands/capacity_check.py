import json
from pathlib import Path
from django.core.management.base import BaseCommand
from api.capacity import Harness


class Command(BaseCommand):
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("--samples", type=int, default=20)
        parser.add_argument("--json", dest="json_path")
        parser.add_argument("--no-contention", action="store_true")

    def handle(self, **options):
        try:
            evidence = Harness().run(options["samples"], not options["no_contention"])
            text = json.dumps(evidence, sort_keys=True)
            if options["json_path"]:
                Path(options["json_path"]).write_text(text + "\n", encoding="utf-8")
        except Exception:
            self.stdout.write("capacity setup failed")
            raise SystemExit(2)
        self.stdout.write(text)
        for name, workload in evidence["workloads"].items():
            for phase, result in workload.items():
                if not result["passed"]:
                    self.stdout.write(f"budget missed: {name} {phase}")
        if not evidence["passed"]:
            raise SystemExit(1)
