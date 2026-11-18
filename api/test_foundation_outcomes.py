from unittest.mock import patch
from django.http import JsonResponse
from django.test import SimpleTestCase, RequestFactory
from mawareeth.middleware import FoundationOutcomeMiddleware, foundation_outcome
from django.test import TestCase
from api.tests import InterviewHelpers

class OutcomeTests(SimpleTestCase):
    def test_all_codes(self):
        rows = [(200, {}, "ok"), (200, {"status":"unavailable"}, "refused"),
          (200, {"status":"choose_school"}, "choose_school"), (200, {"status":"not_ready"}, "not_ready"),
          (409, {}, "conflict"), (409, {"error":"cascade_unconfirmed"}, "confirm"),
          (400, {"error":"over_capacity"}, "limit"), (400, {"errors":{"death":"limit"}}, "limit"),
          (400, {}, "invalid"), (401, {}, "denied"), (403, {}, "denied"),
          (404, {}, "not_found"), (410, {}, "not_found"), (429, {}, "throttled"),
          (503, {"error":"busy"}, "busy"), (503, {}, "unavailable"), (500, {}, "error")]
        for status, data, expected in rows:
            self.assertEqual(foundation_outcome(status, data, "case-preview"), expected)

    def test_redaction_and_bucket(self):
        request = RequestFactory().post("/api/v1/case/heirs/private-id/?token=sentinel-token", {"name":"sentinel-name", "email":"sentinel-email"})
        middleware = FoundationOutcomeMiddleware(lambda request: JsonResponse({"error":"busy"}, status=503))
        with patch("mawareeth.middleware.time.perf_counter", side_effect=[1, 1.6]), self.assertLogs("mawareeth.foundation") as logs:
            middleware(request)
        self.assertEqual(len(logs.records), 1)
        record = logs.records[0]
        self.assertEqual((record.outcome, record.bucket, record.levelname), ("busy", "le_1000", "WARNING"))
        for value in ("sentinel-name", "sentinel-email", "sentinel-token", "private-id"):
            self.assertNotIn(value, str(record.__dict__))

    def test_exception(self):
        def fail(request):
            raise RuntimeError("sentinel-exception")
        with self.assertLogs("mawareeth.foundation") as logs:
            with self.assertRaises(RuntimeError):
                FoundationOutcomeMiddleware(fail)(RequestFactory().get("/api/v1/case/"))
        self.assertEqual(logs.records[0].outcome, "error")
        self.assertNotIn("sentinel-exception", str(logs.records[0].__dict__))

    def test_other_route(self):
        with patch("mawareeth.middleware.foundation_logger.log") as log:
            FoundationOutcomeMiddleware(lambda request: JsonResponse({}))(RequestFactory().get("/api/v1/auth/login/"))
        log.assert_not_called()


class RequestOutcomeTests(InterviewHelpers, TestCase):
    def test_heir_and_death_limits(self):
        from api.capacity import Harness
        from api.throttling import CaseWriteThrottle
        case = self.ready()
        with self.assertLogs("mawareeth.foundation") as logs:
            response = self.send("post", "/api/v1/case/heirs/bulk/", {
                "case_id":case["id"], "heirs":[{"relationship":"son"}]*51})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(logs.records[0].outcome, "limit")
        harness = Harness()
        try:
            with patch.object(CaseWriteThrottle, "allow_request", return_value=True):
                client, case = harness.build("later_deaths_compare")
                wife = next(row["id"] for row in case["heirs"] if row["relationship"] == "wife")
                with self.assertLogs("mawareeth.foundation") as logs:
                    response, _, _ = harness.request(client, "POST", "/api/v1/case/deaths/", {
                        "case_id":case["id"], "expected_revision":case["revision"], "heir_id":wife})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(logs.records[0].outcome, "limit")
        finally:
            from django.contrib.sessions.models import Session
            Session.objects.filter(pk__in=harness.keys).delete()

    def test_no_logger_records_body_sentinels(self):
        case = self.ready()
        with self.assertLogs(level="DEBUG") as logs:
            self.send("post", "/api/v1/case/heirs/?token=sentinel-token", {
                "case_id": case["id"], "expected_revision": case["revision"], "relationship": "son",
                "name": "sentinel-name", "email": "sentinel-email@example.invalid"})
        self.assertTrue(any(record.name == "mawareeth.foundation" for record in logs.records))
        text = "\n".join(logs.output) + "".join(str(record.__dict__) for record in logs.records)
        for value in ("sentinel-name", "sentinel-email", "sentinel-token", case["id"]):
            self.assertNotIn(value, text)

    def test_real_commands_conflict_and_refusal(self):
        case = self.ready()
        with self.assertLogs("mawareeth.foundation") as logs:
            self.heir(case, name="sentinel-name")
        self.assertEqual(len(logs.records), 1)
        self.assertEqual(logs.records[0].outcome, "ok")
        self.assertNotIn("sentinel-name", str(logs.records[0].__dict__))
        with self.assertLogs("mawareeth.foundation") as logs:
            self.heir(case, expected_revision=case["revision"])
        self.assertEqual(logs.records[0].outcome, "conflict")
        self.send("patch", "/api/v1/case/", {"case_id":case["id"], "madhab":"jafari"})
        with self.assertLogs("mawareeth.foundation") as logs:
            self.client.get("/api/v1/case/preview/", {"case_id":case["id"]}, secure=True)
        self.assertEqual(logs.records[0].outcome, "refused")
