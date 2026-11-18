import io
import json
from unittest import skipUnless
from unittest.mock import patch
from django.contrib.sessions.models import Session
from django.core.management import call_command
from django.db import connection
from django.test import TransactionTestCase
from api.capacity import Harness, WORKLOADS, stats
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
