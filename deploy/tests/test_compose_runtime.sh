#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime="$root/deploy/runtime.sh"
compose="$root/deploy/compose.yaml"
routes="$root/deploy/caddy/active-slot.caddy"
example="$root/deploy/runtime.env.example"
real_docker="$(command -v docker 2>/dev/null || true)"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
need() { grep -Fq -- "$2" "$1" || fail "missing $2 in $1"; }

bash -n "$runtime" "$0"
need "$compose" '80:80'
need "$compose" '443:443'
need "$compose" 'internal: true'
need "$compose" 'condition: service_healthy'
need "$compose" 'max-size: "10m"'
need "$compose" 'mawareeth-postgres-data'
need "$compose" 'DOMAIN: ${DOMAIN:?use deploy/runtime.sh as the supported entrypoint}'
need "$compose" 'http://127.0.0.1/health/caddy'
need "$compose" 'format: raw'
need "$compose" 'required: true'
[[ "$(grep -Ec '^[[:space:]]+- "(80|443):' "$compose")" == 2 ]] || fail 'only TCP 80/443 may be published'
! grep -Fq '/udp' "$compose" || fail 'HTTP/3 UDP publication is outside the approved scope'
! grep -Eq '^[[:space:]]+- "(5432|8000):' "$compose" || fail 'private service port is published'
[[ "$(grep -c 'internal: true' "$compose")" == 1 ]] || fail 'only the database network may be internal'
need "$routes" 'reverse_proxy app-blue:8000'
! grep -Eq 'app-green|migrate|switch' "$routes" || fail 'route file automates a switch or migration'
! grep -Eq '^[[:space:]]*(#|$)' "$example" || fail 'runtime example must be directly installable without comments or blank lines'

tmp="$(mktemp -d)"
runtime_copy=''
trap 'rm -rf "$tmp"; rm -f -- "$runtime_copy"' EXIT
stub="$tmp/bin"; state="$tmp/docker-state"; mkdir -p "$stub" "$state"
head_sha="$(git -C "$root" rev-parse HEAD)"
app_digest='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
cat > "$tmp/manifest.json" <<EOF
{"manifest_version":1,"release":{"version":"$head_sha","commit_sha":"$head_sha"},"application":{"image":"ghcr.io/example/mawareeth@$app_digest","digest":"$app_digest"},"deployment_bundle":{"git_sha":"$head_sha"},"configuration":{"schema_version":"1"},"database":{"migration_contract":"expand-migrate-contract-v1"},"ci":{"workflow":"Django CI","workflow_run_id":"1"}}
EOF
chmod 600 "$tmp/manifest.json"
cat > "$tmp/runtime.env" <<'EOF'
DOMAIN=example.com
APP_IMAGE_REPOSITORY=ghcr.io/example/mawareeth
POSTGRES_DB=mawareeth
POSTGRES_USER=mawareeth
POSTGRES_PASSWORD=LongUrlSafePassword_123456
DJANGO_KEY=a-long-django-$-#-quote-'-"-key-that-is-never-printed-123456
MAILGUN_ACCESS_KEY=mailgun-secret-value
MAILGUN_SERVER_NAME=mg.example.com
EOF
chmod 600 "$tmp/runtime.env"

cat > "$stub/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
echo "$*" >> "${TEST_LOG:-/dev/null}"
case "${1:-} ${2:-}" in
  'compose version') exit 0 ;;
  'compose --project-name')
    printf '%s\n' "$*" >> '__COMPOSE_LOG__'
    env | sort > '__COMPOSE_ENV__'
    [[ ! -e '__STATE__/fail-compose' ]] || exit 1
    exit 0 ;;
  'image inspect')
    [[ "${STUB_FAIL_IMAGE:-0}" != 1 ]] || exit 1
    if [[ "$*" == *RepoDigests* ]]; then
      printf '%s\n' \
        'ghcr.io/example/mawareeth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
        'docker.io/library/caddy@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52' \
        'docker.io/library/postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3'
    else printf 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'; fi ;;
  'volume ls')
    [[ ! -e "$TEST_STATE/fail-volume-list" ]] || exit 1
    filter="${*: -1}"; name="${filter#name=^}"; name="${name%$}"
    [[ -e "$TEST_STATE/$name" ]] && printf '%s\n' "$name" || true ;;
  'volume inspect')
    name="${*: -1}"
    [[ -e "$TEST_STATE/$name" ]] || exit 1
    [[ ! -e "$TEST_STATE/fail-inspect-$name" ]] || exit 1
    if [[ "$*" == *Mountpoint* ]]; then printf '/safe/%s\n' "$name"
    elif [[ "$*" == *Labels* ]]; then
      if [[ -e "$TEST_STATE/foreign-$name" ]]; then printf 'foreign foreign\n'
      else case "$name" in *postgres*) printf 'mawareeth postgres\n';; *caddy-data*) printf 'mawareeth caddy-data\n';; *) printf 'mawareeth caddy-config\n';; esac; fi
    else printf '[]\n'; fi ;;
  'volume create') touch "$TEST_STATE/${*: -1}"; printf '%s\n' "${*: -1}" ;;
  'run --rm') [[ -e "$TEST_STATE/pg-version" ]] && cat "$TEST_STATE/pg-version" || true ;;
  *) exit 1 ;;
esac
EOF
sed -i "s|__COMPOSE_LOG__|$tmp/compose.log|; s|__COMPOSE_ENV__|$tmp/compose.env|; s|__STATE__|$state|g" "$stub/docker"
chmod +x "$stub/docker"

# The runtime requires real root metadata. When tests run unprivileged, stub only
# ownership-changing/metadata commands while retaining real filesystem modes.
if [[ ${EUID:-999} -ne 0 ]]; then
  cat > "$stub/stat" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == -c && "$2" == '%u:%g:%a' ]]; then
  if [[ "$3" == *unsafe-mode.env ]]; then printf '0:0:644\n'
  elif [[ "$3" == *unsafe-manifest.json ]]; then printf '0:0:644\n'
  elif [[ "$3" == *unsafe-lock ]]; then printf '0:0:600\n'
  elif [[ "$3" == *runtime-images.lock || "$3" == *bad-lock ]]; then printf '0:0:644\n'
  elif [[ "$3" == *manifest.json ]]; then printf '0:0:600\n'
  else mode="$(/usr/bin/stat -c '%a' "$3")"; printf '0:0:%s\n' "$mode"; fi
else
  /usr/bin/stat "$@"
fi
EOF
  cat > "$stub/chown" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "$stub/install" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == -d ]]; then path="${*: -1}"; mkdir -p "$path"; chmod 700 "$path"; else /usr/bin/install "$@"; fi
EOF
  chmod +x "$stub/stat" "$stub/chown" "$stub/install"
fi

run_runtime() {
  TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
    MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/runtime" bash "$runtime" "$@"
}

# If the shell itself is unprivileged, run a copy with only the root execution
# gate replaced; production code still has no test bypass.
tested_runtime="$runtime"
if [[ ${EUID:-999} -ne 0 ]]; then
  tested_runtime="$(mktemp "$root/deploy/.runtime-test.XXXXXX")"
  runtime_copy="$tested_runtime"
  sed 's/\[\[ ${EUID:-999} -eq 0 \]\]/[[ 0 -eq 0 ]]/' "$runtime" > "$tested_runtime"
  runtime="$tested_runtime"
fi

run_runtime prepare >/dev/null
snapshots=("$tmp/runtime"/*.snapshot.env)
[[ ${#snapshots[@]} == 1 ]] || fail 'preparation did not create exactly one snapshot'
if [[ "$OSTYPE" != msys* && "$OSTYPE" != cygwin* ]]; then
  [[ "$(stat -c '%a' "${snapshots[0]}")" == 600 ]] || fail 'snapshot is not mode 0600'
fi
need "${snapshots[0]}" 'DATABASE_URL=postgresql://mawareeth:LongUrlSafePassword_123456@postgres:5432/mawareeth'
need "${snapshots[0]}" 'DJANGO_KEY=a-long-django-$-#-quote-'\''-"-key-that-is-never-printed-123456'
! grep -Fq APP_IMAGE_REPOSITORY "${snapshots[0]}" || fail 'snapshot contains infrastructure-only values'
first_snapshot="${snapshots[0]}"
run_runtime prepare >/dev/null
snapshots=("$tmp/runtime"/*.snapshot.env)
[[ ${#snapshots[@]} == 1 && "${snapshots[0]}" == "$first_snapshot" ]] || fail 'repeat preparation duplicated state'

rm -rf "$tmp/config-only-state"
TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/config-only-state" bash "$runtime" config >/dev/null
[[ ! -e "$tmp/config-only-state" ]] || fail 'config command created persistent runtime state'

HOSTILE_INHERITED_SECRET='must-not-reach-compose' run_runtime up >/dev/null
grep -Fq -- 'up -d --no-build --pull never' "$tmp/compose.log" || fail 'runtime up did not invoke bounded Compose start'
need "$tmp/compose.env" 'APP_IMAGE=ghcr.io/example/mawareeth@sha256:'
need "$tmp/compose.env" "APP_SNAPSHOT=$first_snapshot"
need "$tmp/compose.env" 'DOMAIN=example.com'
! grep -Fq HOSTILE_INHERITED_SECRET "$tmp/compose.env" || fail 'Compose inherited an unsanitized environment value'

if STUB_FAIL_IMAGE=1 TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/inspect-failure" bash "$runtime" prepare >/dev/null 2>&1; then
  fail 'image inspection failure was accepted'
fi
[[ ! -e "$tmp/inspect-failure" ]] || fail 'image inspection failure mutated snapshot state'

printf 'drift\n' > "$first_snapshot"
if run_runtime prepare >/dev/null 2>&1; then fail 'snapshot content drift was accepted'; fi
rm -rf "$tmp/runtime"
run_runtime prepare >/dev/null

rm -rf "$tmp/pre-compose-state"; : > "$state/fail-compose"
before_mutations="$(grep -Ec 'volume create|compose --project-name.* up' "$tmp/docker.log" 2>/dev/null || true)"
if TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/pre-compose-state" bash "$runtime" prepare >/dev/null 2>&1; then
  fail 'invalid resolved Compose model was accepted'
fi
rm -f "$state/fail-compose"
[[ ! -e "$tmp/pre-compose-state" ]] || fail 'Compose validation failure published persistent state'
[[ "$(grep -Ec 'volume create|compose --project-name.* up' "$tmp/docker.log" 2>/dev/null || true)" == "$before_mutations" ]] || fail 'Compose validation failure mutated Docker state'

assert_path_rejected_without_mutation() {
  local label="$1" runtime_path="$2" state_path="$3" before output
  before="$(grep -Ec 'volume create|compose --project-name.* up' "$tmp/docker.log" 2>/dev/null || true)"
  if output="$(TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$runtime_path" \
    MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$state_path" bash "$runtime" prepare 2>&1)"; then
    fail "$label was accepted"
  fi
  [[ "$(grep -Ec 'volume create|compose --project-name.* up' "$tmp/docker.log" 2>/dev/null || true)" == "$before" ]] || fail "$label caused Docker mutation"
  [[ "$output" != *'LongUrlSafePassword_123456'* && "$output" != *'a-long-django-$-#-quote'* && "$output" != *'mailgun-secret-value'* ]] || fail "$label leaked a secret"
}

cp "$tmp/runtime.env" "$tmp/unsafe-mode.env"
chmod 644 "$tmp/unsafe-mode.env"
assert_path_rejected_without_mutation 'unsafe runtime-file mode' "$tmp/unsafe-mode.env" "$tmp/unsafe-mode-state"
ln -s "$tmp/runtime.env" "$tmp/symlink.env"
if [[ -L "$tmp/symlink.env" ]]; then
  assert_path_rejected_without_mutation 'symlink runtime file' "$tmp/symlink.env" "$tmp/symlink-state"
else
  need "$runtime" '! -L "$path"'
fi
printf 'not-a-directory\n' > "$tmp/unsafe-state"
assert_path_rejected_without_mutation 'unsafe runtime state path' "$tmp/runtime.env" "$tmp/unsafe-state"

for bad in \
  'POSTGRES_PASSWORD=unsafe/password' \
  'DOMAIN=https://example.com' \
  "DOMAIN=$(printf 'a%.0s' {1..250}).com" \
  'MAILGUN_SERVER_NAME=-invalid.example.com' \
  'EXTRA_SECRET=unexpected'; do
  cp "$tmp/runtime.env" "$tmp/bad.env"
  if [[ "$bad" == EXTRA_* ]]; then printf '%s\n' "$bad" >> "$tmp/bad.env"; else sed -i "s|^${bad%%=*}=.*|$bad|" "$tmp/bad.env"; fi
  chmod 600 "$tmp/bad.env"
  if TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/bad.env" MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/bad-state" bash "$runtime" prepare >/dev/null 2>&1; then
    fail "malformed runtime value was accepted: ${bad%%=*}"
  fi
done

cp "$tmp/manifest.json" "$tmp/unsafe-manifest.json"; chmod 644 "$tmp/unsafe-manifest.json"
if TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/unsafe-manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/bad-state" bash "$runtime" prepare >/dev/null 2>&1; then
  fail 'unsafe release-manifest mode was accepted'
fi
cp "$root/deploy/runtime-images.lock" "$tmp/unsafe-lock"; chmod 600 "$tmp/unsafe-lock"
if TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/bad-state" MAWAREETH_RUNTIME_IMAGE_LOCK="$tmp/unsafe-lock" bash "$runtime" prepare >/dev/null 2>&1; then
  fail 'unsafe runtime image-lock mode was accepted'
fi

cp "$tmp/runtime.env" "$tmp/relative-state.env"
if TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/relative-state.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR='relative/runtime' bash "$runtime" prepare >/dev/null 2>&1; then
  fail 'relative runtime state path was accepted'
fi

sed 's#docker.io/library/caddy:2.11.4#docker.io/library/caddy:latest#' "$root/deploy/runtime-images.lock" > "$tmp/bad-lock"
chmod 644 "$tmp/bad-lock"
if TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/bad-state" MAWAREETH_RUNTIME_IMAGE_LOCK="$tmp/bad-lock" bash "$runtime" prepare >/dev/null 2>&1; then
  fail 'mutable infrastructure image was accepted'
fi

for volume in mawareeth-postgres-data mawareeth-caddy-data mawareeth-caddy-config; do
  touch "$state/$volume" "$state/foreign-$volume"
  if run_runtime prepare >/dev/null 2>&1; then fail "foreign volume metadata was accepted for $volume"; fi
  rm -f "$state/foreign-$volume"
done
touch "$state/fail-inspect-mawareeth-caddy-data"
if run_runtime prepare >/dev/null 2>&1; then fail 'Docker volume inspection failure was treated as absence'; fi
rm -f "$state/fail-inspect-mawareeth-caddy-data"
printf '16\n' > "$state/pg-version"
if run_runtime prepare >/dev/null 2>&1; then fail 'incompatible PG_VERSION was accepted'; fi

wrong_repo_stub="$tmp/wrong-repo-docker"
cp "$stub/docker" "$wrong_repo_stub"
sed -i 's#ghcr.io/example/mawareeth@sha256:#ghcr.io/foreign/mawareeth@sha256:#' "$wrong_repo_stub"
mv "$stub/docker" "$stub/docker.good"; cp "$wrong_repo_stub" "$stub/docker"; chmod +x "$stub/docker"
if run_runtime prepare >/dev/null 2>&1; then fail 'matching digest from the wrong repository was accepted'; fi
mv "$stub/docker.good" "$stub/docker"

if [[ -n "$real_docker" ]] && "$real_docker" compose version >/dev/null 2>&1; then
  APP_IMAGE="ghcr.io/example/mawareeth@$app_digest" APP_SNAPSHOT="$first_snapshot" DOMAIN=example.com \
    POSTGRES_DB=mawareeth POSTGRES_USER=mawareeth POSTGRES_PASSWORD=offline-placeholder \
    CADDY_IMAGE='docker.io/library/caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52' \
    POSTGRES_IMAGE='docker.io/library/postgres:17.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3' \
    "$real_docker" compose --project-name mawareeth -f "$compose" config --quiet
fi

printf '%s\n' 'compose runtime offline checks passed'
