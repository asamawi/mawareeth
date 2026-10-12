#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_dir="$root/deploy"
compose_file="$deploy_dir/compose.yaml"
lock_file="${MAWAREETH_RUNTIME_IMAGE_LOCK:-$deploy_dir/runtime-images.lock}"
runtime_file="${MAWAREETH_RUNTIME_FILE:-/etc/mawareeth/runtime.env}"
manifest_file="${MAWAREETH_RELEASE_MANIFEST:-}"
state_dir="${MAWAREETH_RUNTIME_DIR:-$deploy_dir/runtime}"
project=mawareeth
postgres_major=17

die() { printf 'runtime: %s\n' "$*" >&2; exit 2; }
info() { printf 'runtime: %s\n' "$*" >&2; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"; }
safe_path() { [[ "$1" == /* && "$1" != *$'\n'* ]] || die "$2 must be an absolute path"; }

file_metadata() {
  local path="$1" expected_mode="$2" description="$3" metadata
  [[ -f "$path" && ! -L "$path" ]] || die "$description must be a regular non-symlink file"
  metadata="$(stat -c '%u:%g:%a' "$path" 2>/dev/null)" || die "cannot inspect $description"
  [[ "$metadata" == "0:0:$expected_mode" ]] || die "$description must be owned by root:root with mode $expected_mode"
}

load_raw_env() {
  local file="$1" line key value
  declare -gA runtime_values=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] || die 'runtime file contains a blank line'
    [[ "$line" != *$'\r'* && "$line" != [[:space:]]* && "$line" != *[[:space:]] ]] || die 'runtime file contains whitespace'
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || die 'runtime file must contain raw KEY=VALUE lines'
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    [[ -z "${runtime_values[$key]+x}" ]] || die "runtime file contains duplicate key: $key"
    [[ -n "$value" ]] || die "runtime value is empty: $key"
    runtime_values[$key]="$value"
  done < "$file"
  local expected=' APP_IMAGE_REPOSITORY DJANGO_KEY DOMAIN MAILGUN_ACCESS_KEY MAILGUN_SERVER_NAME POSTGRES_DB POSTGRES_PASSWORD POSTGRES_USER '
  for key in "${!runtime_values[@]}"; do [[ "$expected" == *" $key "* ]] || die "runtime file contains unsupported key: $key"; done
  for key in APP_IMAGE_REPOSITORY DJANGO_KEY DOMAIN MAILGUN_ACCESS_KEY MAILGUN_SERVER_NAME POSTGRES_DB POSTGRES_PASSWORD POSTGRES_USER; do
    [[ -n "${runtime_values[$key]:-}" ]] || die "runtime file is missing required key: $key"
  done
}

validate_values() {
  local key
  for key in "${!runtime_values[@]}"; do
    [[ "${runtime_values[$key]}" != *[$'\001'-$'\037'$'\177']* ]] || die "runtime value contains a control character: $key"
  done
  validate_hostname "${runtime_values[DOMAIN]}" DOMAIN lowercase
  [[ "${runtime_values[APP_IMAGE_REPOSITORY]}" =~ ^ghcr\.io/[a-z0-9]+([._-][a-z0-9]+)*/[a-z0-9]+([._-][a-z0-9]+)*$ ]] || die 'APP_IMAGE_REPOSITORY must be a canonical lowercase GHCR repository'
  [[ "${runtime_values[POSTGRES_DB]}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die 'POSTGRES_DB is invalid'
  [[ "${runtime_values[POSTGRES_USER]}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die 'POSTGRES_USER is invalid'
  [[ "${runtime_values[POSTGRES_PASSWORD]}" =~ ^[A-Za-z0-9._~-]{20,128}$ ]] || die 'POSTGRES_PASSWORD must be 20-128 URL-safe unreserved characters'
  ((${#runtime_values[DJANGO_KEY]} >= 32)) || die 'DJANGO_KEY must contain at least 32 characters'
  validate_hostname "${runtime_values[MAILGUN_SERVER_NAME]}" MAILGUN_SERVER_NAME anycase
}

validate_hostname() {
  local value="$1" description="$2" case_rule="$3" label remainder
  ((${#value} <= 253)) || die "$description exceeds the DNS hostname length limit"
  [[ "$value" == *.* && "$value" != .* && "$value" != *. && "$value" != *..* ]] || die "$description must be a DNS hostname"
  [[ "$case_rule" != lowercase || "$value" != *[A-Z]* ]] || die "$description must be lowercase"
  remainder="$value"
  while :; do
    label="${remainder%%.*}"
    ((${#label} <= 63)) || die "$description contains an overlong DNS label"
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || die "$description contains an invalid DNS label"
    [[ "$remainder" == *.* ]] || break
    remainder="${remainder#*.}"
  done
}

load_lock() {
  local line key value
  declare -gA locked=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^(CADDY_IMAGE|POSTGRES_IMAGE)=([^[:space:]]+)$ ]] || die 'runtime image lock is malformed'
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    [[ -z "${locked[$key]+x}" ]] || die "runtime image lock contains duplicate key: $key"
    locked[$key]="$value"
  done < "$lock_file"
  [[ "${locked[CADDY_IMAGE]:-}" == 'docker.io/library/caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52' ]] || die 'Caddy image is outside the allowlist'
  [[ "${locked[POSTGRES_IMAGE]:-}" == 'docker.io/library/postgres:17.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3' ]] || die 'PostgreSQL image is outside the allowlist'
}

validate_manifest() {
  safe_path "$manifest_file" MAWAREETH_RELEASE_MANIFEST
  file_metadata "$manifest_file" 600 'release manifest'
  local values
  values="$(python3 - "$manifest_file" "${runtime_values[APP_IMAGE_REPOSITORY]}" "$deploy_dir" <<'PY'
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[3])
from release_manifest import ManifestError, _reject_duplicate_keys, validate_manifest

try:
    raw = Path(sys.argv[1]).read_bytes()
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=_reject_duplicate_keys)
    validate_manifest(value, expected_repository=sys.argv[2])
except (OSError, UnicodeDecodeError, json.JSONDecodeError, ManifestError):
    raise SystemExit(2)
print(value["application"]["image"])
print(value["deployment_bundle"]["git_sha"])
PY
)" || die 'release manifest validation failed'
  values="${values//$'\r'/}"
  APP_IMAGE="${values%%$'\n'*}"
  local bundle_sha="${values#*$'\n'}" current_sha
  current_sha="$(git -C "$root" rev-parse HEAD 2>/dev/null)" || die 'deployment bundle must be a Git checkout'
  [[ "$bundle_sha" == "$current_sha" ]] || die 'release manifest deployment bundle does not match this checkout'
}

validate_image() {
  local image="$1" image_id repo_digests tagged_repository repository expected
  image_id="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null)" || die 'a required digest-pinned image is not available locally'
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'image inspection returned an invalid immutable ID'
  repo_digests="$(docker image inspect --format '{{join .RepoDigests "\n"}}' "$image" 2>/dev/null)" || die 'image repository metadata could not be inspected'
  tagged_repository="${image%@*}"
  repository="${tagged_repository%:*}"
  [[ "${tagged_repository##*/}" == *:* ]] || repository="$tagged_repository"
  expected="$repository@${image##*@}"
  grep -Fxq -- "$expected" <<<"$repo_digests" || die "local image metadata does not contain requested repository digest"
}

volume_spec() {
  case "$1" in
    mawareeth-postgres-data) printf '%s\n' postgres ;;
    mawareeth-caddy-data) printf '%s\n' caddy-data ;;
    mawareeth-caddy-config) printf '%s\n' caddy-config ;;
    *) return 1 ;;
  esac
}

validate_existing_volume() {
  local name="$1" role="$2" labels mountpoint pg_version
  labels="$(docker volume inspect --format '{{index .Labels "com.mawareeth.owner"}} {{index .Labels "com.mawareeth.role"}}' "$name" 2>/dev/null)" || die "cannot inspect existing volume $name"
  [[ "$labels" == "mawareeth $role" ]] || die "existing volume $name has foreign ownership or role labels"
  if [[ "$role" == postgres ]]; then
    mountpoint="$(docker volume inspect --format '{{.Mountpoint}}' "$name" 2>/dev/null)" || die 'cannot inspect PostgreSQL volume mountpoint'
    [[ "$mountpoint" == /* ]] || die 'PostgreSQL volume mountpoint metadata is invalid'
    pg_version="$(docker run --rm -v "$name:/var/lib/postgresql/data:ro" --entrypoint sh "${locked[POSTGRES_IMAGE]}" -c 'test ! -e /var/lib/postgresql/data/PG_VERSION || cat /var/lib/postgresql/data/PG_VERSION' 2>/dev/null)" || die 'cannot inspect PostgreSQL PG_VERSION'
    [[ -z "$pg_version" || "$pg_version" == "$postgres_major" ]] || die "PostgreSQL volume major version is incompatible"
  fi
}

volume_exists() {
  local name="$1" matches
  matches="$(docker volume ls --quiet --filter "name=^${name}$" 2>/dev/null)" || die "cannot enumerate Docker volumes while checking $name"
  [[ -z "$matches" ]] && return 1
  [[ "$matches" == "$name" ]] || die "Docker volume lookup returned unexpected metadata for $name"
}

prepare_volumes() {
  local name role
  for name in mawareeth-postgres-data mawareeth-caddy-data mawareeth-caddy-config; do
    role="$(volume_spec "$name")"
    if volume_exists "$name"; then
      validate_existing_volume "$name" "$role"
    fi
  done
  for name in mawareeth-postgres-data mawareeth-caddy-data mawareeth-caddy-config; do
    role="$(volume_spec "$name")"
    if ! volume_exists "$name"; then
      docker volume create --label com.mawareeth.owner=mawareeth --label "com.mawareeth.role=$role" "$name" >/dev/null || die "could not create volume $name"
    fi
    validate_existing_volume "$name" "$role"
  done
}

snapshot_content() {
  printf '%s\n' "DJANGO_ENV=production
DJANGO_DEBUG=False
DJANGO_KEY=${runtime_values[DJANGO_KEY]}
DJANGO_ALLOWED_HOSTS=${runtime_values[DOMAIN]}
DJANGO_CSRF_TRUSTED_ORIGINS=https://${runtime_values[DOMAIN]}
DATABASE_URL=postgresql://${runtime_values[POSTGRES_USER]}:${runtime_values[POSTGRES_PASSWORD]}@postgres:5432/${runtime_values[POSTGRES_DB]}
DATABASE_SSL_MODE=disable
MAILGUN_ACCESS_KEY=${runtime_values[MAILGUN_ACCESS_KEY]}
MAILGUN_SERVER_NAME=${runtime_values[MAILGUN_SERVER_NAME]}"
}

write_snapshot() {
  local content hash target temporary
  content="$(snapshot_content)"
  hash="$(printf '%s\n' "$content" | sha256sum | awk '{print $1}')"
  target="$state_dir/$hash.snapshot.env"
  if [[ -e "$state_dir" ]]; then
    [[ -d "$state_dir" && ! -L "$state_dir" ]] || die 'runtime state path must be a directory'
    [[ "$(stat -c '%u:%g:%a' "$state_dir")" == '0:0:700' ]] || die 'runtime state directory must be root:root mode 0700'
  else
    install -d -o root -g root -m 0700 "$state_dir" || die 'could not create runtime state directory'
  fi
  if [[ -e "$target" ]]; then
    file_metadata "$target" 600 'existing runtime snapshot'
    [[ "$(sha256sum "$target" | awk '{print $1}')" == "$hash" ]] || die 'existing runtime snapshot content drifted'
  else
    temporary="$(mktemp "$state_dir/.snapshot.XXXXXX")" || die 'could not allocate atomic snapshot'
    trap 'rm -f -- "${temporary:-}"' RETURN
    printf '%s\n' "$content" > "$temporary"
    chown root:root "$temporary" && chmod 0600 "$temporary" || die 'could not protect runtime snapshot'
    [[ "$(sha256sum "$temporary" | awk '{print $1}')" == "$hash" ]] || die 'runtime snapshot validation failed'
    if ! ln -- "$temporary" "$target" 2>/dev/null; then
      file_metadata "$target" 600 'concurrently published runtime snapshot'
      [[ "$(sha256sum "$target" | awk '{print $1}')" == "$hash" ]] || die 'concurrently published runtime snapshot content drifted'
    fi
    rm -f -- "$temporary"
    temporary=''
    trap - RETURN
  fi
  APP_SNAPSHOT="$target"
}

validate_compose_model() {
  local temporary_dir temporary_snapshot
  temporary_dir="$(mktemp -d)" || die 'could not allocate temporary Compose validation directory'
  trap 'rm -rf -- "${temporary_dir:-}"' RETURN
  chmod 0700 "$temporary_dir" || die 'could not protect temporary Compose validation directory'
  temporary_snapshot="$temporary_dir/app.snapshot.env"
  snapshot_content > "$temporary_snapshot"
  chmod 0600 "$temporary_snapshot" || die 'could not protect temporary Compose validation snapshot'
  APP_SNAPSHOT="$temporary_snapshot"
  compose config --quiet
  rm -rf -- "$temporary_dir"
  temporary_dir=''
  trap - RETURN
}

preflight() {
  [[ ${EUID:-999} -eq 0 ]] || die 'must run as root'
  require_command docker; require_command python3; require_command git; require_command stat; require_command sha256sum; require_command install; require_command ln
  docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin is unavailable'
  safe_path "$runtime_file" MAWAREETH_RUNTIME_FILE
  safe_path "$manifest_file" MAWAREETH_RELEASE_MANIFEST
  safe_path "$lock_file" MAWAREETH_RUNTIME_IMAGE_LOCK
  safe_path "$state_dir" MAWAREETH_RUNTIME_DIR
  file_metadata "$runtime_file" 600 'runtime file'
  load_raw_env "$runtime_file"
  validate_values
  [[ -n "$manifest_file" ]] || die 'MAWAREETH_RELEASE_MANIFEST is required'
  file_metadata "$lock_file" 644 'runtime image lock'
  load_lock
  validate_manifest
  validate_image "$APP_IMAGE"
  validate_image "${locked[CADDY_IMAGE]}"
  validate_image "${locked[POSTGRES_IMAGE]}"
}

compose() {
  env -i PATH="$PATH" HOME="${HOME:-/root}" APP_IMAGE="$APP_IMAGE" APP_SNAPSHOT="$APP_SNAPSHOT" DOMAIN="${runtime_values[DOMAIN]}" \
    POSTGRES_DB="${runtime_values[POSTGRES_DB]}" POSTGRES_USER="${runtime_values[POSTGRES_USER]}" POSTGRES_PASSWORD="${runtime_values[POSTGRES_PASSWORD]}" \
    CADDY_IMAGE="${locked[CADDY_IMAGE]}" POSTGRES_IMAGE="${locked[POSTGRES_IMAGE]}" \
    docker compose --project-name "$project" --project-directory "$deploy_dir" -f "$compose_file" "$@"
}

command="${1:-}"
case "$command" in
  prepare) preflight; validate_compose_model; prepare_volumes; write_snapshot; info "prepared immutable runtime snapshot ${APP_SNAPSHOT##*/}" ;;
  up) preflight; validate_compose_model; prepare_volumes; write_snapshot; compose up -d --no-build --pull never ;;
  config) preflight; validate_compose_model ;;
  status) preflight; write_snapshot; compose ps ;;
  logs) shift; preflight; write_snapshot; compose logs "$@" ;;
  down) preflight; write_snapshot; compose down ;;
  *) die 'usage: runtime.sh {prepare|up|config|status|logs|down}' ;;
esac
