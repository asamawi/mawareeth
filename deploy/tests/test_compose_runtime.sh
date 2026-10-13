#!/usr/bin/env bash
# shellcheck disable=SC2016 # literal $ patterns are intentional in assertions.
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
need "$routes" 'header_down X-Mawareeth-Slot blue'
! grep -Eq 'app-green|migrate|switch' "$routes" || fail 'route seed automates a switch or migration'
need "$compose" 'APP_BLUE_IMAGE:?'
need "$compose" 'APP_GREEN_IMAGE:?'
need "$compose" '${ROUTES_DIR:?use deploy/runtime.sh as the supported entrypoint}:/etc/caddy/routes:ro'
need "$compose" 'stop_grace_period: 35s'
! grep -Eq '^[[:space:]]+image: \$\{APP_IMAGE' "$compose" || fail 'both slots still share one image variable'
! grep -Fq './caddy:' "$compose" || fail 'Caddy still mounts the tracked route seed'
[[ "$(grep -c 'condition: service_healthy' "$compose")" == 2 ]] || fail 'Caddy must not be gated on one application slot'
! grep -Eq '^[[:space:]]+- "?[0-9.:]*2019' "$compose" || fail 'the Caddy admin port must never be published'
need "$root/deploy/Caddyfile" 'admin localhost:2019'
! grep -Fq 'admin off' "$root/deploy/Caddyfile" || fail 'Caddy admin API must be enabled on container loopback for reloads'
! grep -Eq '^[[:space:]]*(#|$)' "$example" || fail 'runtime example must be directly installable without comments or blank lines'

# Resolve the real tools before any stub shadows them.
real_stat="$(command -v stat)"; real_install="$(command -v install)"; real_flock="$(command -v flock 2>/dev/null || true)"
real_sync="$(command -v sync)"

tmp="$(mktemp -d)"
case "$tmp" in "$root"/*) fail 'temporary directory must be outside the checkout' ;; esac
trap 'rm -rf "$tmp"' EXIT
stub="$tmp/bin"; state="$tmp/docker-state"; bundle="$tmp/bundle"; mkdir -p "$stub" "$state" "$bundle/deploy/caddy"

# Run a disposable deployment bundle in its own Git repository outside this
# checkout. When the shell is unprivileged only the root execution gate is
# replaced; production code still has no test bypass.
cp "$compose" "$root/deploy/Caddyfile" "$root/deploy/runtime-images.lock" "$root/deploy/release_manifest.py" "$bundle/deploy/"
cp "$routes" "$bundle/deploy/caddy/"
cp "$root/.gitignore" "$bundle/.gitignore"
if [[ ${EUID:-999} -ne 0 ]]; then
  sed 's/\[\[ ${EUID:-999} -eq 0 \]\]/[[ 0 -eq 0 ]]/' "$runtime" > "$bundle/deploy/runtime.sh"
  grep -Fq 'EUID' "$bundle/deploy/runtime.sh" && fail 'root-gate patch was not applied'
  grep -Fq '[[ 0 -eq 0 ]]' "$bundle/deploy/runtime.sh" || fail 'root-gate patch was not applied'
else
  cp "$runtime" "$bundle/deploy/runtime.sh"
fi
git -C "$bundle" init -q
git -C "$bundle" add -A
git -C "$bundle" -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false commit -q -m bundle
runtime="$bundle/deploy/runtime.sh"
head_sha="$(git -C "$bundle" rev-parse HEAD)"
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
# shellcheck disable=SC2016 # literal $ patterns are intentional in assertions.
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
  elif [[ "$3" == */routes ]]; then printf '0:0:755\n'
  elif [[ "$3" == */routes/*.caddy ]]; then printf '0:0:644\n'
  else mode="$('__STAT__' -c '%a' "$3")"; printf '0:0:%s\n' "$mode"; fi
else
  exec '__STAT__' "$@"
fi
EOF
  cat > "$stub/chown" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "$stub/install" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == -d ]]; then path="${*: -1}"; mkdir -p "$path"; chmod 700 "$path"; else exec '__INSTALL__' "$@"; fi
EOF
  sed -i "s|__STAT__|$real_stat|g; s|__INSTALL__|$real_install|g" "$stub/stat" "$stub/install"
  ! grep -Fq '__' "$stub/stat" "$stub/install" || fail 'stub placeholders were not substituted'
  chmod +x "$stub/stat" "$stub/chown" "$stub/install"
fi
if [[ -z "$real_flock" ]]; then
  printf '#!/usr/bin/env bash\n[[ ! -e %q ]]\n' "$tmp/lock-held" > "$stub/flock"
  chmod +x "$stub/flock"
fi
# Some platforms cannot fsync a read-only handle; keep the call, drop the effect.
printf 'probe\n' > "$tmp/sync-probe"
if ! "$real_sync" -- "$tmp/sync-probe" 2>/dev/null; then
  printf '#!/usr/bin/env bash\nexit 0\n' > "$stub/sync"; chmod +x "$stub/sync"
fi

run_runtime() {
  TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
    MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/runtime" bash "$runtime" "$@"
}

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

need "$tmp/runtime/routes/active-slot.caddy" 'reverse_proxy app-blue:8000'
need "$tmp/runtime/routes/active-slot.caddy" 'header_down X-Mawareeth-Slot blue'
[[ -z "$(find "$tmp/runtime/slots" -type f -print -quit)" ]] || fail 'prepare recorded a slot release'

# Runtime up refusals: no state mutation and no Compose start.
compose_starts() { grep -c -- ' up -d ' "$tmp/compose.log" 2>/dev/null || true; }
expect_up_refused() {
  local label="$1" message="$2" before output
  before="$(compose_starts)"
  if output="$(run_runtime up 2>&1)"; then fail "runtime up accepted $label"; fi
  [[ "$output" == *"$message"* ]] || fail "runtime up refused $label without saying: $message"
  [[ "$(compose_starts)" == "$before" ]] || fail "runtime up started services despite $label"
}
expect_up_refused 'a runtime with no active release record' 'bootstrap the first release with deploy/release.sh deploy'
image_a="ghcr.io/example/mawareeth@$app_digest"
other_image='ghcr.io/example/mawareeth@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
other_commit='0123456789abcdef0123456789abcdef01234567'
write_record() { (umask 077; printf 'IMAGE=%s\nCOMMIT=%s\nSNAPSHOT=%s\n' "$2" "$3" "${first_snapshot##*/}" > "$tmp/runtime/slots/$1.env"); }
write_record blue "$other_image" "$head_sha"
expect_up_refused 'image drift' 'different image'
write_record blue "$image_a" "$other_commit"
expect_up_refused 'commit drift' 'different commit'
write_record blue "$image_a" "$head_sha"
(umask 077; printf 'phase=migrating\nprior_slot=blue\ncandidate_slot=green\nmanifest_commit=%s\nprior_commit=%s\nresult=in-progress\nstarted_at=2026-01-01T00:00:00Z\nupdated_at=2026-01-01T00:00:00Z\ndeploy_log=/var/log/deploy.log\nmigrate_log=/var/log/migrate.log\n' "$head_sha" "$head_sha" > "$tmp/runtime/deploy.journal")
expect_up_refused 'a non-idle deploy journal' 'is not idle'
if run_runtime prepare >/dev/null 2>&1; then fail 'runtime prepare ran with a non-idle deploy journal'; fi
if run_runtime down >/dev/null 2>&1; then fail 'runtime down ran with a non-idle deploy journal'; fi
rm -f "$tmp/runtime/deploy.journal"
if [[ -n "$real_flock" ]]; then
  exec 8>>"$tmp/runtime/deploy.lock"; "$real_flock" -n 8
  expect_up_refused 'a held deploy lock' 'holds'
  exec 8>&-
else
  touch "$tmp/lock-held"; expect_up_refused 'a held deploy lock' 'holds'; rm -f "$tmp/lock-held"
fi

: > "$tmp/compose.log"
HOSTILE_INHERITED_SECRET='must-not-reach-compose' run_runtime up >/dev/null
[[ "$(grep -E -- ' up -d ' "$tmp/compose.log" | sed -E 's/.* //')" == $'postgres\napp-blue\ncaddy' ]] || fail 'runtime up did not start postgres, the active slot, then Caddy'
grep -E -- ' up -d .*--wait --wait-timeout [0-9]+ postgres$' "$tmp/compose.log" >/dev/null || fail 'runtime up did not wait for PostgreSQL'
grep -E -- ' up -d .*--no-deps --wait --wait-timeout [0-9]+ app-blue$' "$tmp/compose.log" >/dev/null || fail 'runtime up did not wait for the active slot'
need "$tmp/compose.env" "APP_BLUE_IMAGE=$image_a"
need "$tmp/compose.env" "APP_GREEN_IMAGE=$image_a"
need "$tmp/compose.env" "ROUTES_DIR=$tmp/runtime/routes"
need "$tmp/compose.env" "APP_SNAPSHOT=$first_snapshot"
need "$tmp/compose.env" 'DOMAIN=example.com'
! grep -Eq '^APP_IMAGE=' "$tmp/compose.env" || fail 'Compose still receives a shared application image'
! grep -Fq HOSTILE_INHERITED_SECRET "$tmp/compose.env" || fail 'Compose inherited an unsanitized environment value'
[[ ! -e "$tmp/runtime/slots/green.env" ]] || fail 'runtime up recorded a release for the idle slot'

# After a deploy routed green, up preserves the route and restarts green only.
cp "$tmp/runtime/slots/blue.env" "$tmp/runtime/slots/green.env"
write_record blue "$other_image" "$other_commit"
(umask 022; printf 'reverse_proxy app-green:8000 {\n\thealth_uri /health/ready/\n\thealth_interval 10s\n\thealth_timeout 3s\n\thealth_status 200\n\theader_down X-Mawareeth-Slot green\n}\n' > "$tmp/runtime/routes/active-slot.caddy")
cp "$tmp/runtime/routes/active-slot.caddy" "$tmp/route.green"
: > "$tmp/compose.log"
run_runtime prepare >/dev/null
run_runtime up >/dev/null
cmp -s "$tmp/runtime/routes/active-slot.caddy" "$tmp/route.green" || fail 'runtime changed the persisted green route'
[[ "$(grep -E -- ' up -d ' "$tmp/compose.log" | sed -E 's/.* //')" == $'postgres\napp-green\ncaddy' ]] || fail 'runtime up did not restart the routed green slot'
need "$tmp/compose.env" "APP_GREEN_IMAGE=$image_a"
need "$tmp/compose.env" "APP_BLUE_IMAGE=$other_image"

# A missing route with recorded releases, or a missing seed, is refused clearly.
mv "$tmp/runtime/routes/active-slot.caddy" "$tmp/route.moved"
if output="$(run_runtime prepare 2>&1)"; then fail 'prepare reseeded a route over recorded releases'; fi
[[ "$output" == *'slot records exist'* ]] || fail 'missing route refusal is unclear'
[[ ! -e "$tmp/runtime/routes/active-slot.caddy" ]] || fail 'prepare reseeded a route over recorded releases'
mv "$tmp/route.moved" "$tmp/runtime/routes/active-slot.caddy"
rm -rf "$tmp/seedless"; mv "$bundle/deploy/caddy/active-slot.caddy" "$tmp/seed.moved"
if output="$(TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/seedless" bash "$runtime" prepare 2>&1)"; then
  fail 'prepare accepted a missing route seed'
fi
[[ "$output" == *'tracked route seed'*'is missing'* ]] || fail 'missing route seed refusal is unclear'
mv "$tmp/seed.moved" "$bundle/deploy/caddy/active-slot.caddy"

# Caddy imports every routes/*.caddy, so a stray route file is refused.
(umask 022; printf 'reverse_proxy app-blue:8000\n' > "$tmp/runtime/routes/extra.caddy")
expect_up_refused 'a stray route file' 'unexpected route file extra.caddy'
rm -f "$tmp/runtime/routes/extra.caddy"

# status and logs are read-only: no state directory, snapshot, or record is
# created, even when the configuration drifted from the recorded snapshot.
state_listing() { find "$tmp/runtime" -print | LC_ALL=C sort; }
listing_before="$(state_listing)"
sed 's/^DJANGO_KEY=.*/DJANGO_KEY=another-long-django-key-that-is-never-printed-12345/' "$tmp/runtime.env" > "$tmp/drift.env"; chmod 600 "$tmp/drift.env"
for command in status logs; do
  for env_file in "$tmp/runtime.env" "$tmp/drift.env"; do
    TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$env_file" \
      MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/runtime" bash "$runtime" "$command" >/dev/null 2>&1 \
      || fail "runtime $command failed"
  done
  TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
    MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/status-only-state" bash "$runtime" "$command" >/dev/null 2>&1 \
    || fail "runtime $command failed without state"
  [[ ! -e "$tmp/status-only-state" ]] || fail "runtime $command created runtime state"
done
[[ "$(state_listing)" == "$listing_before" ]] || fail 'status or logs changed runtime state'

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
  APP_BLUE_IMAGE="ghcr.io/example/mawareeth@$app_digest" APP_GREEN_IMAGE="ghcr.io/example/mawareeth@$app_digest" ROUTES_DIR="$tmp/runtime/routes" APP_SNAPSHOT="$first_snapshot" DOMAIN=example.com \
    POSTGRES_DB=mawareeth POSTGRES_USER=mawareeth POSTGRES_PASSWORD=offline-placeholder \
    CADDY_IMAGE='docker.io/library/caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52' \
    POSTGRES_IMAGE='docker.io/library/postgres:17.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3' \
    "$real_docker" compose --project-name mawareeth -f "$compose" config --quiet
fi

printf '%s\n' 'compose runtime offline checks passed'
