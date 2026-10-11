import copy
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path

from deploy import release_manifest


GIT_SHA = "0123456789abcdef0123456789abcdef01234567"
IMAGE_DIGEST = "sha256:" + ("a" * 64)


class ReleaseManifestTests(unittest.TestCase):
    def build_manifest(self):
        return release_manifest.build_manifest(
            git_sha=GIT_SHA,
            image_repository="ghcr.io/example/mawareeth",
            image_digest=IMAGE_DIGEST,
            configuration_schema="1",
            migration_contract="expand-migrate-contract-v1",
            workflow_run_id="12345",
        )

    def test_builds_complete_canonical_manifest(self):
        manifest = self.build_manifest()

        self.assertEqual(manifest["release"]["commit_sha"], GIT_SHA)
        self.assertEqual(manifest["deployment_bundle"]["git_sha"], GIT_SHA)
        self.assertEqual(
            manifest["application"]["image"],
            f"ghcr.io/example/mawareeth@{IMAGE_DIGEST}",
        )
        self.assertEqual(manifest["configuration"]["schema_version"], "1")
        self.assertEqual(manifest["database"]["migration_contract"], "expand-migrate-contract-v1")

    def test_serialization_is_deterministic(self):
        expected = release_manifest.serialize_manifest(self.build_manifest())

        self.assertEqual(release_manifest.serialize_manifest(self.build_manifest()), expected)
        self.assertTrue(expected.endswith("\n"))

    def test_rejects_missing_and_unknown_fields(self):
        for mutation in ("missing", "unknown"):
            with self.subTest(mutation=mutation):
                manifest = self.build_manifest()
                if mutation == "missing":
                    del manifest["configuration"]["schema_version"]
                else:
                    manifest["secret"] = "must-not-be-accepted"
                with self.assertRaisesRegex(release_manifest.ManifestError, "fields"):
                    release_manifest.validate_manifest(manifest)

    def test_rejects_malformed_or_inconsistent_identity(self):
        changes = (
            (("release", "commit_sha"), "not-a-sha", "release.commit_sha"),
            (("release", "version"), "different", "release.version"),
            (("deployment_bundle", "git_sha"), "f" * 40, "deployment_bundle.git_sha"),
            (("application", "digest"), "sha256:short", "application.digest"),
            (("application", "image"), "ghcr.io/example/mawareeth:latest", "application.image"),
            (("configuration", "schema_version"), "", "configuration.schema_version"),
            (("database", "migration_contract"), "unsafe contract", "database.migration_contract"),
            (("configuration", "schema_version"), "999", "configuration.schema_version"),
            (("configuration", "schema_version"), ["1"], "configuration.schema_version"),
            (("database", "migration_contract"), "expand-migrate-contract-v2", "database.migration_contract"),
            (("application", "image"), "ghcr.io/example/mawareeth@sha256:" + ("b" * 64), "application.image"),
            (("application", "image"), "ghcr.io/Example/mawareeth@" + IMAGE_DIGEST, "application.image"),
            (("ci", "workflow"), "Other CI", "ci.workflow"),
            (("ci", "workflow_run_id"), "0", "ci.workflow_run_id"),
            (("ci", "workflow_run_id"), 12345, "ci.workflow_run_id"),
        )
        for path, value, message in changes:
            with self.subTest(path=path):
                manifest = self.build_manifest()
                manifest[path[0]][path[1]] = value
                with self.assertRaisesRegex(release_manifest.ManifestError, message):
                    release_manifest.validate_manifest(manifest)

    def test_rejects_non_integer_manifest_version(self):
        for value in (2, True, 1.0, "1"):
            with self.subTest(value=value):
                manifest = self.build_manifest()
                manifest["manifest_version"] = value
                with self.assertRaisesRegex(release_manifest.ManifestError, "manifest_version"):
                    release_manifest.validate_manifest(manifest)

    def test_accepts_valid_oci_repository_separators(self):
        for repository in ("ghcr.io/my--org/mawareeth", "ghcr.io/example/my__app", "ghcr.io/example/team/app"):
            with self.subTest(repository=repository):
                manifest = self.build_manifest()
                manifest["application"]["image"] = f"{repository}@{IMAGE_DIGEST}"
                release_manifest.validate_manifest(manifest)

    def test_enforces_expected_repository(self):
        manifest = self.build_manifest()
        release_manifest.validate_manifest(manifest, expected_repository="ghcr.io/example/mawareeth")
        with self.assertRaisesRegex(release_manifest.ManifestError, "expected repository"):
            release_manifest.validate_manifest(manifest, expected_repository="ghcr.io/other/mawareeth")

    def test_cli_rejects_unreadable_and_duplicate_key_input(self):
        valid = json.dumps(self.build_manifest())
        duplicate = valid[:-1] + ', "manifest_version": 1}'
        cases = {"not-utf8": b"\xff\xfe{","duplicate-keys": duplicate.encode("utf-8")}
        for name, content in cases.items():
            with self.subTest(case=name), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "manifest.json"
                path.write_bytes(content)
                with redirect_stderr(StringIO()):
                    self.assertEqual(release_manifest.main(["validate", "--input", str(path)]), 2)

    def test_cli_build_reports_unwritable_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "missing" / "release-manifest.json"
            with redirect_stderr(StringIO()):
                result = release_manifest.main(
                    [
                        "build",
                        "--git-sha", GIT_SHA,
                        "--image-repository", "ghcr.io/example/mawareeth",
                        "--image-digest", IMAGE_DIGEST,
                        "--configuration-schema", "1",
                        "--migration-contract", "expand-migrate-contract-v1",
                        "--workflow-run-id", "12345",
                        "--output", str(output),
                    ]
                )

        self.assertEqual(result, 2)

    def test_cli_build_and_validate_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "release-manifest.json"
            result = release_manifest.main(
                [
                    "build",
                    "--git-sha", GIT_SHA,
                    "--image-repository", "ghcr.io/example/mawareeth",
                    "--image-digest", IMAGE_DIGEST,
                    "--configuration-schema", "1",
                    "--migration-contract", "expand-migrate-contract-v1",
                    "--workflow-run-id", "12345",
                    "--expected-repository", "ghcr.io/example/mawareeth",
                    "--output", str(output),
                ]
            )

            self.assertEqual(result, 0)
            self.assertEqual(
                release_manifest.main(
                    ["validate", "--input", str(output), "--expected-repository", "ghcr.io/example/mawareeth"]
                ),
                0,
            )
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), self.build_manifest())

    def test_cli_error_does_not_echo_untrusted_values(self):
        secret = "super-secret-runtime-token"
        manifest = copy.deepcopy(self.build_manifest())
        manifest["secret"] = secret
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            stderr = StringIO()
            with redirect_stderr(stderr):
                result = release_manifest.main(["validate", "--input", str(path)])

        self.assertEqual(result, 2)
        self.assertNotIn(secret, stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
