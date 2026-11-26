import io
import json
from pathlib import Path
from unittest.mock import patch
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db.backends.base.base import BaseDatabaseWrapper
from django.test import SimpleTestCase, TestCase, override_settings
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
        self.assertEqual(out.getvalue(), "rollback reader check skipped: --rollback-reads not provided\nfailed: purity\n")

    def run_gates(self, *args):
        out = io.StringIO()
        with patch("api.management.commands.release_check.gates", return_value={}):
            call_command("release_check", *args, stdout=out)
        return out.getvalue()

    def test_rollback_reader_check_skipped_without_a_rollback_target(self):
        self.assertEqual(self.run_gates(), "rollback reader check skipped: --rollback-reads not provided\nrelease checks passed\n")

    @override_settings(SNAPSHOT_WRITE_VERSION=1)
    def test_schema_1_writer_passes_any_rollback_target(self):
        for reads in ("1", "1,2"):
            with self.subTest(reads=reads):
                self.assertEqual(self.run_gates("--rollback-reads", reads), "release checks passed\n")

    def test_schema_2_writer_needs_a_rollback_target_that_reads_it(self):
        with override_settings(SNAPSHOT_WRITE_VERSION=2):
            self.assertEqual(self.run_gates("--rollback-reads", "1,2"), "release checks passed\n")
            # The phase-1 image reads schema 1 only: a rollback to it could not open converted cases.
            with self.assertRaises(SystemExit) as error:
                self.run_gates("--rollback-reads", "1")
        self.assertEqual(error.exception.code, 1)

    def test_malformed_rollback_reads_fail(self):
        for reads in ("x", "", "1,,2", "1.5"):
            out = io.StringIO()
            with self.subTest(reads=reads), patch("api.management.commands.release_check.gates", return_value={}):
                with self.assertRaises(SystemExit) as error:
                    call_command("release_check", "--rollback-reads", reads, stdout=out)
                self.assertEqual(error.exception.code, 1)
                self.assertEqual(out.getvalue(), "failed: rollback\n")

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

    def test_a_long_name_within_100_graphemes_passes_and_one_beyond_fails(self):
        name = "\u0645\u064e" * 100
        self.assertGreater(len(name), 100)
        SavedCase.objects.filter(pk=self.row.pk).update(name=name)
        out = io.StringIO()
        call_command("restore_check", stdout=out)
        self.assertIn("failures=0", out.getvalue())
        SavedCase.objects.filter(pk=self.row.pk).update(name="x" * 101)
        with self.assertRaises(SystemExit):
            call_command("restore_check", stdout=io.StringIO())

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
