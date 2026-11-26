import io
import json
import tempfile
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch
from django.contrib.sessions.models import Session
from django.core.management import call_command
from django.db import connection
from django.test import TransactionTestCase
from api.capacity import Harness, SetupError, WORKLOADS, stats
from api.models import SavedCase

@skipUnless(connection.vendor == "postgresql", "requires PostgreSQL")
class CapacityTests(TransactionTestCase):
    def test_workloads_cleanup_and_evidence(self):
        before = set(Session.objects.values_list("pk", flat=True))
        saved = SavedCase.objects.count()
        harness = Harness()
        with patch("api.capacity.TOTAL_BUDGET_MS", 100000):
            result = harness.run(2)
        self.assertEqual(set(result["workloads"]), set(WORKLOADS))
        self.assertTrue(result["passed"])
        self.assertEqual(set(Session.objects.values_list("pk", flat=True)), before)
        self.assertEqual(SavedCase.objects.count(), saved)
        for key in harness.keys:
            self.assertNotIn(key, json.dumps(result))
        for workload in result["workloads"].values():
            for phase in workload.values():
                self.assertEqual(phase["n"], 2)
                self.assertIn("conflicts", phase)
                self.assertIn("busy", phase)

    def test_unusable_preview_fails(self):
        faults = (
            {"status": "choose_school"},
            {"presented": None},
            {"presented": {}},
            {"revision": None},
            {"revision": 1},
            {"revision": 0},
            {"revision": True},
            {"revision": "1"},
        )
        original = Harness.request
        before = Session.objects.count()
        for fault in faults:
            with self.subTest(field=next(iter(fault)), value_type=type(next(iter(fault.values()))).__name__):
                def request(harness, client, method, path, data=None):
                    response, sent, received = original(harness, client, method, path, data)
                    if method == "GET" and path.startswith("/api/v1/case/preview/"):
                        self.assertEqual(response.status_code, 200)
                        body = response.json()
                        body.update(fault)
                        # None exercises an absent field, rather than just JSON null.
                        for key, value in fault.items():
                            if value is None:
                                body.pop(key)
                        response.content = json.dumps(body).encode()
                        response.json = lambda: body
                    return response, sent, received
                with patch.object(Harness, "request", request):
                    with self.assertRaises(SetupError):
                        Harness().run(1, False)
                self.assertEqual(Session.objects.count(), before)

    def test_disagree_workload(self):
        self.assertIn("disagree_compare", WORKLOADS)
        original = Harness.request
        statuses = []

        def request(harness, client, method, path, data=None):
            response, sent, received = original(harness, client, method, path, data)
            if method == "GET" and path.startswith("/api/v1/case/preview/"):
                self.assertEqual(response.status_code, 200)
                statuses.append(response.json()["status"])
            return response, sent, received

        with patch("api.capacity.WORKLOADS", ("disagree_compare",)), patch.object(
                Harness, "request", request), patch("api.capacity.TOTAL_BUDGET_MS", 100000):
            result = Harness().run(1, False)
        self.assertEqual(statuses, ["choose_school"])
        self.assertTrue(result["passed"])
        self.assertEqual(result["workloads"]["disagree_compare"]["end_to_end"]["n"], 1)

    def test_failure_cleanup(self):
        before = Session.objects.count()
        with patch("api.capacity.evaluate_outcome", side_effect=RuntimeError("sentinel")):
            with self.assertRaises(RuntimeError):
                Harness().run(1, False)
        self.assertEqual(Session.objects.count(), before)

    def test_failure_after_session_creation_is_cleaned(self):
        before = Session.objects.count()
        with patch("django.test.Client.generic", side_effect=RuntimeError("sentinel")):
            with self.assertRaises(RuntimeError):
                Harness().run(1, False)
        self.assertEqual(Session.objects.count(), before)

    def test_budget_miss(self):
        out = io.StringIO()
        with patch("api.capacity.ENGINE_BUDGET_MS", 0):
            with self.assertRaises(SystemExit) as error:
                call_command("capacity_check", samples=1, no_contention=True, stdout=out)
        self.assertEqual(error.exception.code, 1)
        lines = out.getvalue().splitlines()
        self.assertFalse(json.loads(lines[0])["passed"])
        self.assertIn("budget missed: standard_school engine", lines)
        self.assertIn("budget missed: standard_compare engine", lines)
        self.assertIn("budget missed: fifty_compare placement", lines)
        self.assertFalse(json.loads(lines[0])["workloads"]["fifty_compare"]["placement"]["passed"])

    def test_placement_fits_the_engine_budget_for_fifty_heirs(self):
        with patch("api.capacity.WORKLOADS", ("fifty_compare",)), patch("api.capacity.TOTAL_BUDGET_MS", 100000):
            result = Harness().run(3, False)
        placement = result["workloads"]["fifty_compare"]["placement"]
        self.assertEqual(placement["n"], 3)
        self.assertTrue(placement["passed"], placement)

    def test_end_to_end_budget_miss(self):
        out = io.StringIO()
        with patch("api.capacity.TOTAL_BUDGET_MS", 0):
            with self.assertRaises(SystemExit) as error:
                call_command("capacity_check", samples=1, no_contention=True, stdout=out)
        self.assertEqual(error.exception.code, 1)
        lines = out.getvalue().splitlines()
        evidence = json.loads(lines[0])
        for name in WORKLOADS:
            self.assertFalse(evidence["workloads"][name]["end_to_end"]["passed"])
            self.assertTrue(evidence["workloads"][name]["engine"]["passed"])
            self.assertIn(f"budget missed: {name} end_to_end", lines)

    def test_setup_error(self):
        with self.assertRaises(SystemExit) as error:
            call_command("capacity_check", samples=0, stdout=io.StringIO())
        self.assertEqual(error.exception.code, 2)

    def test_percentile(self):
        self.assertEqual(stats(list(range(1,21)))["p95"], 19)

    # Written out, so dropping a workload or an action from the harness fails here.
    REQUIRED = {
        "school": ("add", "bulk_add", "edit", "delete", "drop", "undo"),
        "compare": ("add", "bulk_add", "edit", "delete", "drop", "undo"),
        "two_later_deaths": ("add", "bulk_add", "edit", "delete", "drop", "undo"),
    }

    def test_interview_mix_reports_every_action_without_payloads(self):
        before = set(Session.objects.values_list("pk", flat=True))
        harness = Harness()
        with patch("api.capacity.WORKLOADS", ()), patch("api.capacity.TOTAL_BUDGET_MS", 100000):
            result = harness.run(2, True, True, device="phone", network="4g")
        self.assertTrue(result["passed"])
        self.assertTrue(result["interview_passed"])
        self.assertEqual((result["device"], result["network"]["label"]), ("phone", "4g"))
        self.assertEqual(set(result["interview"]), set(self.REQUIRED))
        self.assertEqual(set(result["workload"]), set(self.REQUIRED))
        for name, actions in self.REQUIRED.items():
            self.assertEqual(set(result["interview"][name]), set(actions))
            for action in actions:
                phase = result["interview"][name][action]
                self.assertEqual(phase["n"], 2)
                self.assertEqual(len(phase["samples_ms"]), 2)
                self.assertTrue(all(isinstance(v, float) for v in phase["samples_ms"]))
                # One list of attempt records per sample: the write (with any retry or cascade probe), then the preview.
                self.assertEqual(len(phase["attempts"]), 2)
                for attempts in phase["attempts"]:
                    self.assertEqual(attempts[0]["kind"], "write")
                    self.assertEqual(attempts[-1]["kind"], "preview")
                    for attempt in attempts:
                        self.assertTrue({"status", "lock_wait_ms", "request_bytes", "response_bytes"} <= set(attempt))
                        self.assertGreater(attempt["request_bytes"], 0)
                        self.assertGreater(attempt["response_bytes"], 0)
                    self.assertTrue(all(isinstance(a["write_ms"], float) for a in attempts if a["kind"] == "write"))
                    self.assertTrue(all(isinstance(a["preview_ms"], float) and isinstance(a["validation_ms"], float)
                                        for a in attempts if a["kind"] == "preview"))
                    # The write ran under the case lock, so its wait is reported.
                    self.assertTrue(all(isinstance(a["lock_wait_ms"], int) for a in attempts if a["kind"] == "write"))
        # A delete that drops a later estate meets the cascade probe, then succeeds, then previews.
        for attempts in result["interview"]["two_later_deaths"]["delete"]["attempts"]:
            outcomes = [(a["kind"], a["outcome"]) for a in attempts]
            probe = outcomes.index(("write", "cascade_probe"))
            self.assertEqual(attempts[probe]["status"], 409)
            done = outcomes.index(("write", "ok"))
            self.assertLess(probe, done)
            self.assertEqual(outcomes[-1], ("preview", "ok"))
            self.assertLess(done, len(outcomes) - 1)
            for attempt in attempts:
                if attempt["outcome"] == "ok":
                    self.assertGreater(attempt.get("write_ms", attempt.get("preview_ms")), 0)
            preview = attempts[-1]
            self.assertNotEqual(preview["request_bytes"], preview["response_bytes"])
            self.assertLess(preview["request_bytes"], preview["response_bytes"])
        text = json.dumps(result)
        for key in harness.keys:
            self.assertNotIn(key, text)
        for word in ("Edited", "heir_id", "case_id", "snapshot", "name"):
            self.assertNotIn(f'"{word}"', text)
        self.assertEqual(set(Session.objects.values_list("pk", flat=True)), before)

    def run_command(self, **options):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "capacity.json"
            code = 0
            try:
                call_command("capacity_check", samples=1, no_contention=True, json_path=str(path), stdout=out, **options)
            except SystemExit as exit_:
                code = exit_.code
            return code, json.loads(path.read_text(encoding="utf-8")), out.getvalue().splitlines()

    def test_json_file_passes_without_the_interview_mix(self):
        with patch("api.capacity.WORKLOADS", ("standard_school",)):
            code, evidence, _ = self.run_command(no_interview=True)
        self.assertEqual(code, 0)
        self.assertIs(evidence["passed"], True)
        self.assertNotIn("interview", evidence)
        self.assertNotIn("workload", evidence)
        self.assertNotIn("interview_passed", evidence)

    def test_json_file_fails_without_the_interview_mix(self):
        with patch("api.capacity.WORKLOADS", ("standard_school",)), patch("api.capacity.TOTAL_BUDGET_MS", 0):
            code, evidence, _ = self.run_command(no_interview=True)
        self.assertEqual(code, 1)
        self.assertIs(evidence["passed"], False)
        self.assertNotIn("interview", evidence)
        self.assertNotIn("workload", evidence)

    def test_json_file_with_the_interview_mix_passes(self):
        # Keep the network model and budget checks while controlling elapsed server time.
        with patch("api.capacity.WORKLOADS", ("standard_school",)), patch("api.capacity.time") as clock:
            clock.perf_counter.return_value = 0
            code, evidence, _ = self.run_command()
        self.assertEqual(code, 0)
        self.assertIs(evidence["passed"], True)
        self.assertIs(evidence["interview_passed"], True)
        self.assertEqual(set(evidence["interview"]), set(self.REQUIRED))
        self.assertEqual(set(evidence["workload"]), set(self.REQUIRED))

    def test_interview_miss_is_report_only_unless_enforced(self):
        with patch("api.capacity.WORKLOADS", ()), patch("api.capacity.TOTAL_BUDGET_MS", 0):
            code, evidence, lines = self.run_command()
            self.assertEqual(code, 0)
            self.assertIs(evidence["passed"], True)
            self.assertIs(evidence["interview_passed"], False)
            self.assertIn("budget missed: interview school add", lines)
            code, evidence, _ = self.run_command(enforce_interview=True)
            self.assertEqual(code, 1)
            self.assertIs(evidence["passed"], True)
            self.assertIs(evidence["interview_passed"], False)

    def test_edit_step_changes_the_relationship(self):
        case = {"heirs": [{"id": "d", "relationship": "daughter"}, {"id": "s", "relationship": "son"}],
                "deaths": [], "snapshot": {}, "placement": {"x": [{"relationship": "son_of_son", "blocked": False}], "root": [{"relationship": "son", "blocked": False}]}}
        steps, _ = Harness().interview_steps("school", case)
        method, path, body = steps["edit"](case)
        self.assertEqual((method, body["relationship"]), ("PUT", "sister"))
        self.assertTrue(path.endswith("/d/"))
