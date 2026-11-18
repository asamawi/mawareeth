import io
import json
from pathlib import Path
from unittest.mock import patch
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db.backends.base.base import BaseDatabaseWrapper
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from api.models import SavedCase, ShareLink, ShareInvite

class ReleaseTests(SimpleTestCase):
    def test_database_free(self):
        with patch.object(BaseDatabaseWrapper, "ensure_connection", side_effect=AssertionError("database forbidden")), patch("mawareeth.release_gates.glyphs", return_value=None):
            call_command("release_check", stdout=io.StringIO())

    def test_failure_redacted(self):
        def fail():
            raise ValueError("secret")
        out = io.StringIO()
        with patch("api.management.commands.release_check.gates", return_value={"purity":fail}):
            with self.assertRaises(SystemExit) as error:
                call_command("release_check", stdout=out)
        self.assertEqual(error.exception.code, 1)
        self.assertEqual(out.getvalue(), "failed: purity\n")

class RestoreTests(TestCase):
    def setUp(self):
        owner = get_user_model().objects.create_user("restore")
        for version in (1,2):
            value = json.loads((Path(__file__).parent / f"fixtures/snapshots/v{version}-estate.json").read_text())
            self.row = SavedCase.objects.create(owner=owner, schema_version=version, snapshot=value, name="sentinel-name")
        for index, state in enumerate(("active", "revoked", "expired")):
            values = dict(saved_case=self.row, token_hash=str(index), expires_at=timezone.now()+timedelta(days=-1 if state == "expired" else 1), revoked_at=timezone.now() if state == "revoked" else None)
            ShareLink.objects.create(**values)
            ShareInvite.objects.create(**values, email="sentinel-email", accepted_at=timezone.now(), accepted_by=owner)

    def test_counts_and_read_only(self):
        before = list(SavedCase.objects.values())
        out = io.StringIO(); call_command("restore_check", stdout=out)
        self.assertEqual(list(SavedCase.objects.values()), before)
        self.assertIn("version=1 count=1", out.getvalue())
        self.assertIn("version=2 count=1", out.getvalue())
        self.assertIn("active=1 revoked=1 expired=1", out.getvalue())
        self.assertNotIn("sentinel", out.getvalue())

    def test_bad_snapshot(self):
        self.row.snapshot = {}; self.row.save()
        out = io.StringIO()
        with self.assertRaises(SystemExit):
            call_command("restore_check", stdout=out)
        self.assertIn(f"failed_saved_pk={self.row.pk}", out.getvalue())
        self.assertNotIn("sentinel", out.getvalue())

    def test_unsupported_version_and_bad_revision(self):
        for changes in ({"schema_version":99}, {"schema_version":2, "revision":0}):
            SavedCase.objects.filter(pk=self.row.pk).update(**changes)
            with self.assertRaises(SystemExit):
                call_command("restore_check", stdout=io.StringIO())

    def test_migrations_and_catalogs(self):
        for name in ("_schema_ready", "catalogs"):
            with patch("api.management.commands.restore_check."+name, side_effect=RuntimeError("secret")):
                out = io.StringIO()
                with self.assertRaises(SystemExit):
                    call_command("restore_check", stdout=out)
                self.assertNotIn("secret", out.getvalue())

    def test_database_setup_failure_is_redacted(self):
        out = io.StringIO()
        with patch("api.management.commands.restore_check.SavedCase.objects.iterator", side_effect=RuntimeError("secret")):
            with self.assertRaises(SystemExit):
                call_command("restore_check", stdout=out)
        self.assertNotIn("secret", out.getvalue())
