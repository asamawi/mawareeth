import json
import traceback
from pathlib import Path
from django.core.management.base import BaseCommand
from api.capacity import Harness


class Command(BaseCommand):
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("--samples", type=int, default=20)
        parser.add_argument("--json", dest="json_path")
        parser.add_argument("--no-contention", action="store_true")
        parser.add_argument("--no-interview", action="store_true")
        # The Interview mix is reported, but only decides the exit code with this flag.
        parser.add_argument("--enforce-interview", action="store_true")
        # Labels only: the device and network the evidence was measured on ("model" is the harness model).
        parser.add_argument("--device", default="model")
        parser.add_argument("--network", default="model")

    def handle(self, **options):
        try:
            evidence = Harness().run(options["samples"], not options["no_contention"], not options["no_interview"],
                                   options["device"], options["network"])
            text = json.dumps(evidence, sort_keys=True)
            if options["json_path"]:
                Path(options["json_path"]).write_text(text + "\n", encoding="utf-8")
        except Exception:
            self.stdout.write("capacity setup failed")
            # The deploy log keeps stderr too: say where it failed (the first production run said nothing more).
            traceback.print_exc()
            raise SystemExit(2)
        self.stdout.write(text)
        for group in ("workloads", "interview"):
            for name, workload in evidence.get(group, {}).items():
                for phase, result in workload.items():
                    if not result["passed"]:
                        prefix = "interview " if group == "interview" else ""
                        self.stdout.write(f"budget missed: {prefix}{name} {phase}")
        if not evidence["passed"] or (options["enforce_interview"] and evidence.get("interview_passed") is False):
            raise SystemExit(1)
