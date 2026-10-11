import argparse
import json
import re
import sys
from pathlib import Path


MANIFEST_VERSION = 1
CI_WORKFLOW = "Django CI"
# Contract versions are release interfaces; extend these sets only through an
# explicit compatibility decision.
SUPPORTED_CONFIGURATION_SCHEMAS = frozenset({"1"})
SUPPORTED_MIGRATION_CONTRACTS = frozenset({"expand-migrate-contract-v1"})
SHA_PATTERN = re.compile(r"[0-9a-f]{40}")
DIGEST_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
# OCI distribution path components: lowercase alphanumerics joined by ".",
# "_", "__", or one or more "-".
_PATH_COMPONENT = r"[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*"
REPOSITORY_PATTERN = re.compile(rf"ghcr\.io/{_PATH_COMPONENT}(?:/{_PATH_COMPONENT})+")
WORKFLOW_RUN_PATTERN = re.compile(r"[1-9][0-9]*")

EXPECTED_FIELDS = {
    "": {"manifest_version", "release", "application", "deployment_bundle", "configuration", "database", "ci"},
    "release": {"version", "commit_sha"},
    "application": {"image", "digest"},
    "deployment_bundle": {"git_sha"},
    "configuration": {"schema_version"},
    "database": {"migration_contract"},
    "ci": {"workflow", "workflow_run_id"},
}


class ManifestError(ValueError):
    pass


def build_manifest(
    *,
    git_sha,
    image_repository,
    image_digest,
    configuration_schema,
    migration_contract,
    workflow_run_id,
    expected_repository=None,
):
    manifest = {
        "manifest_version": MANIFEST_VERSION,
        "release": {"version": git_sha, "commit_sha": git_sha},
        "application": {
            "image": f"{image_repository}@{image_digest}",
            "digest": image_digest,
        },
        "deployment_bundle": {"git_sha": git_sha},
        "configuration": {"schema_version": configuration_schema},
        "database": {"migration_contract": migration_contract},
        "ci": {"workflow": CI_WORKFLOW, "workflow_run_id": workflow_run_id},
    }
    validate_manifest(manifest, expected_repository=expected_repository)
    return manifest


def validate_manifest(manifest, expected_repository=None):
    if not isinstance(manifest, dict):
        raise ManifestError("manifest must be a JSON object")

    _validate_fields(manifest, "")
    for section in EXPECTED_FIELDS:
        if section:
            value = manifest.get(section)
            if not isinstance(value, dict):
                raise ManifestError(f"{section} must be a JSON object")
            _validate_fields(value, section)

    version = manifest["manifest_version"]
    # bool is an int subclass and 1.0 == 1, so compare the exact type.
    if type(version) is not int or version != MANIFEST_VERSION:
        raise ManifestError("manifest_version is unsupported")

    commit_sha = manifest["release"]["commit_sha"]
    if not _fullmatch(SHA_PATTERN, commit_sha):
        raise ManifestError("release.commit_sha must be a lowercase 40-character Git SHA")
    if manifest["release"]["version"] != commit_sha:
        raise ManifestError("release.version must equal release.commit_sha")
    if manifest["deployment_bundle"]["git_sha"] != commit_sha:
        raise ManifestError("deployment_bundle.git_sha must equal release.commit_sha")

    digest = manifest["application"]["digest"]
    if not _fullmatch(DIGEST_PATTERN, digest):
        raise ManifestError("application.digest must be a sha256 OCI digest")
    image = manifest["application"]["image"]
    repository, separator, image_digest = image.partition("@") if isinstance(image, str) else ("", "", "")
    if not separator or not _fullmatch(REPOSITORY_PATTERN, repository) or not _fullmatch(DIGEST_PATTERN, image_digest):
        raise ManifestError("application.image must be a canonical lowercase GHCR digest reference")
    if image_digest != digest:
        raise ManifestError("application.image must end with application.digest")
    if expected_repository is not None and repository != expected_repository:
        raise ManifestError("application.image is not from the expected repository")

    if not _is_supported(manifest["configuration"]["schema_version"], SUPPORTED_CONFIGURATION_SCHEMAS):
        raise ManifestError("configuration.schema_version is unsupported")
    if not _is_supported(manifest["database"]["migration_contract"], SUPPORTED_MIGRATION_CONTRACTS):
        raise ManifestError("database.migration_contract is unsupported")
    if manifest["ci"]["workflow"] != CI_WORKFLOW:
        raise ManifestError("ci.workflow must identify the validated workflow")
    if not _fullmatch(WORKFLOW_RUN_PATTERN, manifest["ci"]["workflow_run_id"]):
        raise ManifestError("ci.workflow_run_id must be a positive integer string")


def serialize_manifest(manifest):
    validate_manifest(manifest)
    return json.dumps(manifest, indent=2, sort_keys=True) + "\n"


def load_manifest(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ManifestError("manifest could not be read as JSON") from error


def write_manifest(manifest, path):
    try:
        Path(path).write_text(serialize_manifest(manifest), encoding="utf-8")
    except OSError as error:
        raise ManifestError("manifest could not be written") from error


def _reject_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise ManifestError("manifest contains duplicate keys")
    return dict(pairs)


def _validate_fields(value, section):
    actual = set(value)
    expected = EXPECTED_FIELDS[section]
    if actual != expected:
        location = section or "manifest"
        raise ManifestError(f"{location} fields do not match the release contract")


def _is_supported(value, supported):
    return isinstance(value, str) and value in supported


def _fullmatch(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Build or validate an immutable release manifest.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build")
    build.add_argument("--git-sha", required=True)
    build.add_argument("--image-repository", required=True)
    build.add_argument("--image-digest", required=True)
    build.add_argument("--configuration-schema", required=True)
    build.add_argument("--migration-contract", required=True)
    build.add_argument("--workflow-run-id", required=True)
    build.add_argument("--expected-repository")
    build.add_argument("--output", required=True)

    validate = subparsers.add_parser("validate")
    validate.add_argument("--input", required=True)
    validate.add_argument("--expected-repository")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    try:
        if args.command == "build":
            manifest = build_manifest(
                git_sha=args.git_sha,
                image_repository=args.image_repository,
                image_digest=args.image_digest,
                configuration_schema=args.configuration_schema,
                migration_contract=args.migration_contract,
                workflow_run_id=args.workflow_run_id,
                expected_repository=args.expected_repository,
            )
            write_manifest(manifest, args.output)
        else:
            validate_manifest(load_manifest(args.input), expected_repository=args.expected_repository)
    except ManifestError as error:
        print(f"release manifest error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
