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
routes_dir="$state_dir/routes"
route_file="$routes_dir/active-slot.caddy"
route_seed="$deploy_dir/caddy/active-slot.caddy"
slots_dir="$state_dir/slots"
journal_file="$state_dir/deploy.journal"
deploy_lock_file="$state_dir/deploy.lock"
startup_timeout="${MAWAREETH_RUNTIME_WAIT_TIMEOUT:-300}"
project=mawareeth
postgres_major=17
APP_IMAGE=''
APP_COMMIT=''
APP_SNAPSHOT=''
APP_BLUE_IMAGE=''
APP_GREEN_IMAGE=''
ROUTES_DIR=''

runtime_saved_traps=''
runtime_pending_signal=''

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

# Optional application keys, appended to the app snapshot in this order when
# present. Absent keys leave the snapshot (and its hash) unchanged.
optional_app_keys=(SITE_ID FACEBOOK_KEY FACEBOOK_SECRET LINKEDIN_KEY LINKEDIN_SECRET)
# Keys every runtime.env must carry. Together with optional_app_keys this is the
# complete allow-list.
required_runtime_keys=(APP_IMAGE_REPOSITORY DJANGO_KEY DOMAIN MAILGUN_ACCESS_KEY MAILGUN_SERVER_NAME POSTGRES_DB POSTGRES_PASSWORD POSTGRES_USER)

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
  local -A allowed=()
  for key in "${required_runtime_keys[@]}" "${optional_app_keys[@]}"; do allowed[$key]=1; done
  for key in "${!runtime_values[@]}"; do [[ -n "${allowed[$key]:-}" ]] || die "runtime file contains unsupported key: $key"; done
  for key in "${required_runtime_keys[@]}"; do
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
  validate_optional_values
}

# Error messages name only the key, never the value.
validate_optional_values() {
  local provider key
  [[ -z "${runtime_values[SITE_ID]+x}" || "${runtime_values[SITE_ID]}" =~ ^[1-9][0-9]{0,9}$ ]] || die 'SITE_ID must be a positive integer without leading zeros'
  # Django's Site.id is a PostgreSQL integer.
  [[ -z "${runtime_values[SITE_ID]+x}" ]] || ((10#${runtime_values[SITE_ID]} <= 2147483647)) || die 'SITE_ID must be at most 2147483647'
  [[ -z "${runtime_values[FACEBOOK_KEY]+x}" || "${runtime_values[FACEBOOK_KEY]}" =~ ^[0-9]{1,32}$ ]] || die 'FACEBOOK_KEY must be 1-32 digits'
  for key in FACEBOOK_SECRET LINKEDIN_KEY LINKEDIN_SECRET; do
    # The raw format only rejects edge whitespace; credentials never contain any.
    [[ -z "${runtime_values[$key]+x}" ]] || { ((${#runtime_values[$key]} <= 256)) && [[ "${runtime_values[$key]}" != *[[:space:]]* ]]; } \
      || die "$key must be at most 256 characters without whitespace"
  done
  for provider in FACEBOOK LINKEDIN; do
    [[ "${runtime_values[${provider}_KEY]+x}" == "${runtime_values[${provider}_SECRET]+x}" ]] \
      || die "${provider}_KEY and ${provider}_SECRET must both be set or both be absent"
  done
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
    [[ "$line" =~ ^(CADDY_IMAGE|POSTGRES_IMAGE|RESTIC_IMAGE)=([^[:space:]]+)$ ]] || die 'runtime image lock is malformed'
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    [[ -z "${locked[$key]+x}" ]] || die "runtime image lock contains duplicate key: $key"
    locked[$key]="$value"
  done < "$lock_file"
  [[ "${locked[CADDY_IMAGE]:-}" == 'docker.io/library/caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52' ]] || die 'Caddy image is outside the allowlist'
  [[ "${locked[POSTGRES_IMAGE]:-}" == 'docker.io/library/postgres:17.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3' ]] || die 'PostgreSQL image is outside the allowlist'
  # Optional: only deploy/backup.sh runs Restic, and it requires the entry.
  [[ -z "${locked[RESTIC_IMAGE]+x}" || "${locked[RESTIC_IMAGE]}" == 'docker.io/restic/restic:0.18.1@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76' ]] || die 'Restic image is outside the allowlist'
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
  # The manifest validator guarantees release.commit_sha equals the bundle SHA.
  APP_COMMIT="$bundle_sha"
}

validate_image() {
  local image="$1" image_id repo_digests tagged_repository repository expected short
  image_id="$(docker image inspect --format '{{.Id}}' "$image" 2>/dev/null)" || die 'a required digest-pinned image is not available locally'
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'image inspection returned an invalid immutable ID'
  repo_digests="$(docker image inspect --format '{{join .RepoDigests "\n"}}' "$image" 2>/dev/null)" || die 'image repository metadata could not be inspected'
  tagged_repository="${image%@*}"
  repository="${tagged_repository%:*}"
  [[ "${tagged_repository##*/}" == *:* ]] || repository="$tagged_repository"
  expected="$repository@${image##*@}"
  # Docker Engine reports Docker Hub repositories in short form: docker.io/library/postgres
  # as postgres and docker.io/restic/restic as restic/restic. The digest must still match.
  short="$expected"
  case "$repository" in
    docker.io/library/*) short="${expected#docker.io/library/}" ;;
    docker.io/*) short="${expected#docker.io/}" ;;
  esac
  grep -Fxq -e "$expected" -e "$short" <<<"$repo_digests" || die "local image metadata does not contain requested repository digest"
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
  local key
  for key in "${optional_app_keys[@]}"; do
    [[ -z "${runtime_values[$key]+x}" ]] || printf '%s=%s\n' "$key" "${runtime_values[$key]}"
  done
}

# snapshot_hash prints the content address of the current snapshot and fails
# rather than hashing empty output when the content cannot be rendered.
snapshot_hash() {
  local content hash
  content="$(snapshot_content)" || return 1
  [[ -n "$content" ]] || return 1
  hash="$(printf '%s\n' "$content" | sha256sum | awk '{print $1}')" || return 1
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$hash"
}

# ensure_state_dir [create|existing] validates the root-only state directory,
# creating it only in create mode.
ensure_state_dir() {
  if [[ -e "$state_dir" || -L "$state_dir" ]]; then
    [[ -d "$state_dir" && ! -L "$state_dir" ]] || die 'runtime state path must be a directory'
    [[ "$(stat -c '%u:%g:%a' "$state_dir")" == '0:0:700' ]] || die 'runtime state directory must be root:root mode 0700'
  elif [[ "${1:-create}" == create ]]; then
    install -d -o root -g root -m 0700 "$state_dir" || die 'could not create runtime state directory'
  else
    die 'runtime state directory is missing; run deploy/runtime.sh prepare first'
  fi
}

# use_existing_snapshot sets APP_SNAPSHOT to the already published snapshot for
# the current configuration without creating one.
use_existing_snapshot() {
  local hash target
  hash="$(snapshot_hash)" || die 'cannot hash the runtime configuration'
  target="$state_dir/$hash.snapshot.env"
  [[ -e "$target" || -L "$target" ]] || die 'no runtime snapshot exists for the current configuration; run deploy/runtime.sh prepare first'
  file_metadata "$target" 600 'runtime snapshot'
  [[ "$(sha256sum "$target" | awk '{print $1}')" == "$hash" ]] || die 'existing runtime snapshot content drifted'
  APP_SNAPSHOT="$target"
}

# runtime_defer_signals and runtime_release_signals bracket each window that
# holds a secret-bearing temporary file. INT/TERM/HUP arriving inside it are
# recorded instead of acted on; Bash runs a trap only after the foreground
# subshell finishes, and that subshell (which resets caught traps to the
# default) dies on the signal, so the parent always removes the file first.
# The release then restores the caller's traps (release.sh sources this file)
# and re-raises the signal. Signals ignored when the window opens stay ignored.
# Windows must not nest: one saved-trap slot serves the whole process.
runtime_defer_signals() {
  runtime_saved_traps="$(trap -p INT TERM HUP)"; runtime_pending_signal=''
  local sig
  for sig in INT TERM HUP; do
    [[ "$(trap -p "$sig")" == "trap -- '' SIG$sig" ]] && continue
    # The first pending signal wins.
    # shellcheck disable=SC2064 # expand $sig now
    trap "[[ -n \"\$runtime_pending_signal\" ]] || runtime_pending_signal=$sig" "$sig"
  done
}

# Restore the caller's traps before resetting the rest, so no signal ever
# meets the default disposition between the two steps.
runtime_release_signals() {
  local sig
  eval "$runtime_saved_traps"
  for sig in INT TERM HUP; do
    [[ $'\n'"$runtime_saved_traps"$'\n' == *" SIG$sig"$'\n'* ]] || trap - "$sig"
  done
  [[ -z "$runtime_pending_signal" ]] || kill -s "$runtime_pending_signal" "$BASHPID"
}

write_snapshot() {
  local content hash target temporary status
  content="$(snapshot_content)"
  hash="$(printf '%s\n' "$content" | sha256sum | awk '{print $1}')"
  target="$state_dir/$hash.snapshot.env"
  ensure_state_dir create
  if [[ -e "$target" ]]; then
    file_metadata "$target" 600 'existing runtime snapshot'
    [[ "$(sha256sum "$target" | awk '{print $1}')" == "$hash" ]] || die 'existing runtime snapshot content drifted'
  else
    runtime_defer_signals
    temporary="$(mktemp "$state_dir/.snapshot.XXXXXX")" || { runtime_release_signals; die 'could not allocate atomic snapshot'; }
    # A subshell, because die exits past RETURN traps; the parent always
    # removes the secret-bearing temporary file.
    set +e
    (
      set -e
      printf '%s\n' "$content" > "$temporary"
      { chown root:root "$temporary" && chmod 0600 "$temporary"; } || die 'could not protect runtime snapshot'
      [[ "$(sha256sum "$temporary" | awk '{print $1}')" == "$hash" ]] || die 'runtime snapshot validation failed'
      if ! ln -- "$temporary" "$target" 2>/dev/null; then
        file_metadata "$target" 600 'concurrently published runtime snapshot'
        [[ "$(sha256sum "$target" | awk '{print $1}')" == "$hash" ]] || die 'concurrently published runtime snapshot content drifted'
      fi
    )
    status=$?
    set -e
    rm -f -- "$temporary"
    runtime_release_signals
    (( status == 0 )) || exit "$status"
  fi
  APP_SNAPSHOT="$target"
}

validate_compose_model() {
  local temporary_dir status
  runtime_defer_signals
  temporary_dir="$(mktemp -d)" || { runtime_release_signals; die 'could not allocate temporary Compose validation directory'; }
  APP_BLUE_IMAGE="$APP_IMAGE"; APP_GREEN_IMAGE="$APP_IMAGE"
  # A subshell, because die exits past RETURN traps; the parent always
  # removes the secret-bearing temporary snapshot.
  set +e
  (
    set -e
    chmod 0700 "$temporary_dir" || die 'could not protect temporary Compose validation directory'
    APP_SNAPSHOT="$temporary_dir/app.snapshot.env"; ROUTES_DIR="$temporary_dir"
    snapshot_content > "$APP_SNAPSHOT"
    chmod 0600 "$APP_SNAPSHOT" || die 'could not protect temporary Compose validation snapshot'
    compose config --quiet >/dev/null || die 'the resolved Compose model is invalid'
  )
  status=$?
  set -e
  rm -rf -- "$temporary_dir"
  runtime_release_signals
  (( status == 0 )) || exit "$status"
  APP_SNAPSHOT=''; ROUTES_DIR=''
}

# preflight_runtime validates everything except the release manifest: the
# runtime file, the image lock, and the locked Caddy and PostgreSQL images.
# deploy/release.sh recover needs no manifest and uses only this part.
preflight_runtime() {
  [[ ${EUID:-999} -eq 0 ]] || die 'must run as root'
  require_command docker; require_command python3; require_command git; require_command stat; require_command sha256sum; require_command install; require_command ln
  require_command timeout; require_command mktemp; require_command mv; require_command sync
  docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin is unavailable'
  safe_path "$runtime_file" MAWAREETH_RUNTIME_FILE
  safe_path "$lock_file" MAWAREETH_RUNTIME_IMAGE_LOCK
  safe_path "$state_dir" MAWAREETH_RUNTIME_DIR
  file_metadata "$runtime_file" 600 'runtime file'
  load_raw_env "$runtime_file"
  validate_values
  file_metadata "$lock_file" 644 'runtime image lock'
  load_lock
  validate_image "${locked[CADDY_IMAGE]}"
  validate_image "${locked[POSTGRES_IMAGE]}"
}

preflight() {
  [[ ${EUID:-999} -eq 0 ]] || die 'must run as root'
  safe_path "$manifest_file" MAWAREETH_RELEASE_MANIFEST
  preflight_runtime
  [[ -n "$manifest_file" ]] || die 'MAWAREETH_RELEASE_MANIFEST is required'
  validate_manifest
  validate_image "$APP_IMAGE"
}

compose() { compose_bounded '' "$@"; }

# compose_bounded SECONDS ARGS... runs Compose with a sanitized environment that
# carries both slot images and the persisted route directory and, unless
# SECONDS is empty, under a hard time limit. Docker never inherits the deploy
# lock descriptor.
compose_bounded() {
  local limit="$1"; shift
  local -a runner=()
  [[ -z "$limit" ]] || runner=(timeout --kill-after=5 "$limit")
  env -i PATH="$PATH" HOME="${HOME:-/root}" APP_BLUE_IMAGE="$APP_BLUE_IMAGE" APP_GREEN_IMAGE="$APP_GREEN_IMAGE" \
    APP_SNAPSHOT="$APP_SNAPSHOT" ROUTES_DIR="$ROUTES_DIR" DOMAIN="${runtime_values[DOMAIN]}" \
    POSTGRES_DB="${runtime_values[POSTGRES_DB]}" POSTGRES_USER="${runtime_values[POSTGRES_USER]}" POSTGRES_PASSWORD="${runtime_values[POSTGRES_PASSWORD]}" \
    CADDY_IMAGE="${locked[CADDY_IMAGE]}" POSTGRES_IMAGE="${locked[POSTGRES_IMAGE]}" \
    "${runner[@]}" docker compose --project-name "$project" --project-directory "$deploy_dir" -f "$compose_file" "$@" 9>&-
}

other_slot() {
  case "$1" in blue) printf 'green\n' ;; green) printf 'blue\n' ;; *) return 1 ;; esac
}

# The canonical persisted route for a slot. Every proxied response is stamped
# with the serving slot so edge verification cannot pass against the wrong one.
route_content() {
  printf 'reverse_proxy app-%s:8000 {\n\thealth_uri /health/ready/\n\thealth_interval 10s\n\thealth_timeout 3s\n\thealth_status 200\n\theader_down X-Mawareeth-Slot %s\n}\n' "$1" "$1"
}

# atomic_write TARGET MODE CONTENT publishes CONTENT and a final newline through
# a same-directory temporary file that is fsynced before the rename; the
# directory is fsynced after it, so readers and crash recovery see either the
# old or the new file.
atomic_write() {
  local target="$1" mode="$2" content="$3" temporary
  temporary="$(mktemp "${target%/*}/.tmp.XXXXXX")" || return 1
  if printf '%s\n' "$content" > "$temporary" && chmod "$mode" "$temporary" && sync -- "$temporary" \
    && mv -f -- "$temporary" "$target" && sync -- "${target%/*}"; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

state_subdir() {
  local path="$1" mode="$2" create="$3"
  if [[ -e "$path" || -L "$path" ]]; then
    [[ -d "$path" && ! -L "$path" ]] || die "runtime state path ${path##*/} must be a directory"
    [[ "$(stat -c '%u:%g:%a' "$path")" == "0:0:$mode" ]] || die "runtime state directory ${path##*/} must be root:root mode $mode"
  elif [[ "$create" == create ]]; then
    install -d -o root -g root -m "$mode" "$path" || die "could not create runtime state directory ${path##*/}"
  else
    die "runtime state directory ${path##*/} is missing; run deploy/runtime.sh prepare first"
  fi
}

# ensure_state_subdirs create|existing
ensure_state_subdirs() {
  state_subdir "$slots_dir" 700 "$1"
  state_subdir "$routes_dir" 755 "$1"
  ROUTES_DIR="$routes_dir"
}

any_slot_record() {
  local slot
  for slot in blue green; do
    [[ ! -e "$slots_dir/$slot.env" && ! -L "$slots_dir/$slot.env" ]] || return 0
  done
  return 1
}

route_seed_content() {
  [[ -f "$route_seed" && ! -L "$route_seed" ]] || die "tracked route seed $route_seed is missing; restore it from the deployment bundle"
  [[ "$(tr -d '\r' < "$route_seed")"$'\n' == "$(route_content blue)"$'\n' ]] || die 'tracked route seed must be the canonical blue route'
  route_content blue
}

# seed_route publishes the tracked blue seed as the persisted route only when no
# route exists and no release has ever been recorded.
seed_route() {
  local content
  if [[ -e "$route_file" || -L "$route_file" ]]; then return 0; fi
  ! any_slot_record || die "persisted route $route_file is missing but slot records exist; follow the manual recovery steps in deploy/README.md"
  content="$(route_seed_content)"
  atomic_write "$route_file" 0644 "$content" || die 'could not seed the persisted route'
  info 'seeded the persisted route to blue'
}

# read_active_slot sets ACTIVE_SLOT from the persisted route file, the
# active-slot authority; returns 1 when the route file is absent.
read_active_slot() {
  local content slot candidate
  # Caddy imports every routes/*.caddy, so any other file would be served too.
  for candidate in "$routes_dir"/*.caddy; do
    [[ ! -e "$candidate" && ! -L "$candidate" ]] || [[ "$candidate" == "$route_file" ]] \
      || die "unexpected route file ${candidate##*/} in $routes_dir; only active-slot.caddy may exist there"
  done
  [[ -e "$route_file" || -L "$route_file" ]] || return 1
  file_metadata "$route_file" 644 'persisted route file'
  content="$(< "$route_file")" || die 'cannot read the persisted route file'
  for slot in blue green; do
    if [[ "$content"$'\n' == "$(route_content "$slot")"$'\n' ]]; then ACTIVE_SLOT="$slot"; return 0; fi
  done
  die 'persisted route file is not a recognized blue/green route'
}

slot_record_content() { printf 'IMAGE=%s\nCOMMIT=%s\nSNAPSHOT=%s\n' "$1" "$2" "$3"; }

# read_slot_record SLOT [SUFFIX] sets SLOT_IMAGE, SLOT_COMMIT and SLOT_SNAPSHOT;
# returns 1 when the record is absent.
read_slot_record() {
  local file="$slots_dir/$1.env${2:-}" content pattern
  [[ -e "$file" || -L "$file" ]] || return 1
  file_metadata "$file" 600 "$1 slot record"
  content="$(< "$file")" || die "cannot read the $1 slot record"
  pattern='^IMAGE=(ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64})'$'\n''COMMIT=([0-9a-f]{40})'$'\n''SNAPSHOT=([0-9a-f]{64}\.snapshot\.env)$'
  [[ "$content" =~ $pattern ]] || die "the $1 slot record is malformed"
  SLOT_IMAGE="${BASH_REMATCH[1]}"
  SLOT_COMMIT="${BASH_REMATCH[2]}"
  SLOT_SNAPSHOT="${BASH_REMATCH[3]}"
}

# Compose interpolates both slot images. An unrecorded slot borrows FALLBACK;
# runtime commands never start the idle slot.
load_slot_images() {
  local fallback="$1" slot image
  for slot in blue green; do
    image="$fallback"
    if [[ -d "$slots_dir" ]] && read_slot_record "$slot"; then image="$SLOT_IMAGE"; fi
    if [[ "$slot" == blue ]]; then APP_BLUE_IMAGE="$image"; else APP_GREEN_IMAGE="$image"; fi
  done
  ROUTES_DIR="$routes_dir"
}

# journal_status returns 0 when the deploy journal is absent or idle, 1 when it
# records an unfinished deploy, and 2 when it is unsafe or malformed. Both the
# current eleven-line format and the legacy ten-line one (without the final
# records= line) are accepted. The parsed fields are left in journal_values;
# journal_values[records] is empty for a legacy journal.
declare -gA journal_values=()
journal_status() {
  local content pattern index name
  local -a names=(phase prior_slot candidate_slot manifest_commit prior_commit result started_at updated_at deploy_log migrate_log)
  journal_values=()
  [[ -e "$journal_file" || -L "$journal_file" ]] || return 0
  [[ -f "$journal_file" && ! -L "$journal_file" ]] || return 2
  [[ "$(stat -c '%u:%g:%a' "$journal_file" 2>/dev/null)" == '0:0:600' ]] || return 2
  content="$(< "$journal_file")" || return 2
  pattern='^phase=(idle|candidate-starting|migrating|candidate-ready|switching|verifying|draining|restore-failed)'$'\n'
  pattern+='prior_slot=(blue|green)?'$'\n''candidate_slot=(blue|green)'$'\n'
  pattern+='manifest_commit=([0-9a-f]{40})'$'\n''prior_commit=([0-9a-f]{40})?'$'\n'
  pattern+='result=(in-progress|verified|success|failed:[a-z-]+)'$'\n'
  pattern+='started_at=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)'$'\n'
  pattern+='updated_at=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)'$'\n'
  pattern+='deploy_log=(/[^[:cntrl:]]+)'$'\n''migrate_log=(/[^[:cntrl:]]+)('$'\n''records=(untouched|replaced))?$'
  [[ "$content" =~ $pattern ]] || return 2
  for index in "${!names[@]}"; do
    name="${names[$index]}"
    journal_values[$name]="${BASH_REMATCH[$((index + 1))]}"
  done
  journal_values[records]="${BASH_REMATCH[12]}"
  [[ "${journal_values[phase]}" == idle ]] || return 1
}

journal_refusal() {
  printf '%s\n' "deploy journal $journal_file $1: an earlier deploy did not finish cleanly.
Run deploy/release.sh recover as root (preview with deploy/release.sh recover --dry-run). If recover refuses,
for example for a legacy ten-line journal, follow the manual recovery steps in deploy/README.md."
}

# acquire_deploy_lock holds an exclusive non-blocking lock on descriptor 9 for
# the rest of the process; returns 1 when another operation holds it.
acquire_deploy_lock() {
  require_command flock
  exec 9>>"$deploy_lock_file" || die "cannot open $deploy_lock_file"
  flock -n 9
}

# Mutating runtime commands serialize with deploys and refuse to act while an
# unfinished deploy is journaled.
guard_mutation() {
  local status=0
  ensure_state_dir create
  acquire_deploy_lock || die "another deploy or runtime operation holds $deploy_lock_file"
  journal_status || status=$?
  case "$status" in
    0) ;;
    1) die "$(journal_refusal 'is not idle')" ;;
    *) die "$(journal_refusal 'is unsafe or malformed')" ;;
  esac
}

runtime_prepare() {
  preflight; validate_compose_model
  guard_mutation
  prepare_volumes; write_snapshot
  ensure_state_subdirs create; seed_route
  info "prepared immutable runtime snapshot ${APP_SNAPSHOT##*/}"
}

# up restarts the recorded active release only; releases change through
# deploy/release.sh deploy, which also bootstraps the first one.
runtime_up() {
  local active hash
  [[ "$startup_timeout" =~ ^[1-9][0-9]{0,3}$ ]] || die 'MAWAREETH_RUNTIME_WAIT_TIMEOUT must be 1-9999 seconds'
  preflight; validate_compose_model
  guard_mutation
  ensure_state_subdirs existing
  read_active_slot || die 'no persisted route exists; run deploy/runtime.sh prepare, then bootstrap with deploy/release.sh deploy'
  active="$ACTIVE_SLOT"
  read_slot_record "$active" || die "app-$active has no release record; bootstrap the first release with deploy/release.sh deploy"
  [[ "$SLOT_IMAGE" == "$APP_IMAGE" ]] || die "app-$active records a different image than the manifest; use deploy/release.sh deploy to change releases"
  [[ "$SLOT_COMMIT" == "$APP_COMMIT" ]] || die "app-$active records a different commit than the manifest; use deploy/release.sh deploy to change releases"
  hash="$(snapshot_hash)" || die 'cannot hash the runtime configuration'
  [[ "$SLOT_SNAPSHOT" == "$hash.snapshot.env" ]] || die 'runtime configuration differs from the active slot snapshot; rotate configuration separately'
  prepare_volumes; use_existing_snapshot
  load_slot_images "$APP_IMAGE"
  compose up -d --no-build --pull never --wait --wait-timeout "$startup_timeout" postgres || die 'PostgreSQL did not become healthy'
  compose up -d --no-build --pull never --no-deps --wait --wait-timeout "$startup_timeout" "app-$active" || die "app-$active did not become healthy"
  compose up -d --no-build --pull never --no-deps caddy || die 'Caddy did not start'
}

# status and logs are read-only: they never create state or snapshots and
# tolerate configuration drift. Compose only needs some readable env file, so
# use the current snapshot, else the active slot's recorded one, else a
# protected temporary rendering removed on exit.
inspect_tmp=''
runtime_inspect() {
  local hash candidate
  preflight
  APP_SNAPSHOT=''
  if hash="$(snapshot_hash)" && [[ -f "$state_dir/$hash.snapshot.env" ]]; then
    APP_SNAPSHOT="$state_dir/$hash.snapshot.env"
  elif [[ -d "$slots_dir" ]]; then
    for candidate in blue green; do
      if read_slot_record "$candidate" && [[ -f "$state_dir/$SLOT_SNAPSHOT" ]]; then APP_SNAPSHOT="$state_dir/$SLOT_SNAPSHOT"; break; fi
    done
  fi
  if [[ -z "$APP_SNAPSHOT" ]]; then
    inspect_tmp="$(mktemp -d)" || die 'could not allocate a temporary inspection directory'
    trap 'rm -rf -- "${inspect_tmp:-}"' EXIT
    snapshot_content > "$inspect_tmp/app.snapshot.env" || die 'could not render a temporary inspection snapshot'
    APP_SNAPSHOT="$inspect_tmp/app.snapshot.env"
  fi
  load_slot_images "$APP_IMAGE"
}

# Sourced by deploy/release.sh; dispatch only when executed directly.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    prepare) runtime_prepare ;;
    up) runtime_up ;;
    config) preflight; validate_compose_model ;;
    status) runtime_inspect; compose ps ;;
    logs) shift; runtime_inspect; compose logs "$@" ;;
    down) preflight; validate_compose_model; guard_mutation; write_snapshot; load_slot_images "$APP_IMAGE"; compose down ;;
    *) die 'usage: runtime.sh {prepare|up|config|status|logs|down}' ;;
  esac
fi
