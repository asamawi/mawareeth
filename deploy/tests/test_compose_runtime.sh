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
# Release identity is never served through the edge: Caddy answers 404 to every
# client, with no source-address exception (IPv6 clients arrive through
# docker-proxy looking private).
grep -Eq '^[[:space:]]*respond /health/release\* 404[[:space:]]*$' "$root/deploy/Caddyfile" \
  || fail 'Caddy must answer /health/release* with 404 for every client'
! grep -Eq 'remote_ip|client_ip|\{remote_host\}' "$root/deploy/Caddyfile" \
  || fail 'Caddy must not rely on client source addresses'
! grep -Eq '^[[:space:]]*respond /health/(live|ready)' "$root/deploy/Caddyfile" \
  || fail 'liveness and readiness must stay public for external monitors'
# Proxy trust: Caddy replaces client X-Forwarded-* only while it trusts no
# upstream proxy and the route does not forward them itself.
route_output="$(bash -c 'source "$1"; route_content blue; route_content green' _ "$runtime")" || fail 'cannot render route_content'
[[ "$route_output" == *'reverse_proxy app-blue:8000'*'reverse_proxy app-green:8000'* ]] || fail 'route_content did not render both slots'
for text in "$(< "$root/deploy/Caddyfile")" "$route_output" "$(cat "$root"/deploy/caddy/edge/acme/*.caddy)"; do
  ! grep -Fqi -e 'trusted_proxies' -e 'header_up x-forwarded' <<<"$text" || fail 'Caddy must not trust or forward client X-Forwarded-* headers'
done
# Edge modes: the Caddyfile imports one snippet set per EDGE_MODE (acme by
# default). acme adds nothing; cloudflare loads the Origin certificate,
# disables certificate automation, redirects REDIRECT_DOMAIN, and trusts
# forwarded headers only from Cloudflare's ranges, never by address matchers.
edge="$root/deploy/caddy/edge"
for part in global site sites; do
  need "$root/deploy/Caddyfile" "import /etc/caddy/edge/{\$EDGE_MODE:acme}/$part.caddy"
  [[ -f "$edge/acme/$part.caddy" && -f "$edge/cloudflare/$part.caddy" ]] || fail "missing edge snippet $part.caddy"
  ! grep -Eqv '^[[:space:]]*(#|$)' "$edge/acme/$part.caddy" || fail "acme edge snippet $part.caddy must add nothing"
done
[[ "$(find "$edge" -type f | wc -l | tr -d ' ')" == 6 ]] || fail 'unexpected edge snippet files'
! grep -Eq 'remote_ip|client_ip|\{remote_host\}' "$edge"/*/*.caddy || fail 'edge snippets must not rely on client source addresses'
need "$edge/cloudflare/global.caddy" 'auto_https disable_certs'
grep -Eq '^[[:space:]]*trusted_proxies static( [0-9a-f.:]+/[0-9]+){10,}$' "$edge/cloudflare/global.caddy" \
  || fail 'cloudflare mode must trust only static Cloudflare ranges'
grep -Eq '^[[:space:]]*trusted_proxies static.* 173\.245\.48\.0/20 .* 2400:cb00::/32 ' "$edge/cloudflare/global.caddy" \
  || fail 'cloudflare trusted ranges must include IPv4 and IPv6 ranges'
need "$edge/cloudflare/site.caddy" 'tls /etc/caddy/origin-tls/cert.pem /etc/caddy/origin-tls/key.pem'
need "$edge/cloudflare/sites.caddy" '{$REDIRECT_DOMAIN:unprepared-redirect.invalid} {'
need "$edge/cloudflare/sites.caddy" 'tls /etc/caddy/origin-tls/cert.pem /etc/caddy/origin-tls/key.pem'
need "$edge/cloudflare/sites.caddy" 'redir https://{$DOMAIN:unprepared.invalid}{uri} permanent'
need "$compose" 'EDGE_MODE: ${EDGE_MODE:?use deploy/runtime.sh as the supported entrypoint}'
need "$compose" 'REDIRECT_DOMAIN: ${REDIRECT_DOMAIN-}'
need "$compose" './caddy/edge:/etc/caddy/edge:ro'
need "$compose" '${EDGE_TLS_DIR:?use deploy/runtime.sh as the supported entrypoint}:/etc/caddy/origin-tls:ro'
# No catch-all trust: every trusted range is at least a /8 (IPv4) or /12 (IPv6).
ranges_line="$(grep -E '^[[:space:]]*trusted_proxies static ' "$edge/cloudflare/global.caddy")"
read -ra trusted_ranges <<<"${ranges_line#*static }"
for range in "${trusted_ranges[@]}"; do
  prefix="${range##*/}"
  [[ "$range" =~ ^[0-9a-f.:]+/[0-9]{1,3}$ ]] || fail "trusted range $range is malformed"
  if [[ "$range" == *:* ]]; then ((10#$prefix >= 12)) || fail "trusted IPv6 range $range is broader than /12"
  else ((10#$prefix >= 8)) || fail "trusted IPv4 range $range is broader than /8"; fi
done
# Only Cloudflare's public Origin CA roots are tracked. No tracked file under
# deploy/ carries a private key; the test suites' own fixtures are excluded.
ca_bundle="$root/deploy/cloudflare-origin-ca.pem"
[[ "$(grep -c -- '-----BEGIN CERTIFICATE-----' "$ca_bundle")" == 2 ]] || fail 'the Origin CA bundle must hold the RSA and ECC roots'
tracked_deploy="$(git -C "$root" ls-files -- deploy)" || fail 'cannot list tracked deploy files'
[[ -n "$tracked_deploy" ]] || fail 'git ls-files listed no deploy files'
while IFS= read -r tracked; do
  [[ "$tracked" != deploy/tests/* ]] || continue
  ! grep -Eq -- '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----' "$root/$tracked" || fail "tracked file $tracked contains a private key"
done <<<"$tracked_deploy"
# OpenSSL builds the certificate fixtures and reads the pinned roots. It is
# required in CI; a workstation without it skips those checks with a note.
have_openssl=0
if command -v openssl >/dev/null 2>&1; then have_openssl=1
elif [[ -n "${CI:-}" ]]; then fail 'openssl is required in CI'
else printf 'NOTE: openssl is unavailable; skipping the Origin certificate and pinned-root checks\n' >&2; fi
# The pinned roots are exactly the ones whose fingerprints deploy/README.md lists.
if ((have_openssl)); then
  tmp_roots="$(mktemp -d)"
  readme_prints="$(grep -E '^\| CloudFlare Origin .*\| `([0-9A-F]{2}:){31}[0-9A-F]{2}` \|$' "$root/deploy/README.md" | grep -Eo '([0-9A-F]{2}:){31}[0-9A-F]{2}' | LC_ALL=C sort)"
  bundle_prints="$(awk -v dir="$tmp_roots" '/-----BEGIN CERTIFICATE-----/ { n++; inside = 1 } inside { print > (dir "/root" n ".pem") } /-----END CERTIFICATE-----/ { inside = 0; close(dir "/root" n ".pem") }' "$ca_bundle"
    for pem in "$tmp_roots"/root*.pem; do openssl x509 -in "$pem" -noout -fingerprint -sha256 | sed 's/^.*=//'; done | tr -d '\r' | LC_ALL=C sort)"
  [[ "$(wc -l <<<"$readme_prints" | tr -d ' ')" == 2 ]] || fail 'deploy/README.md must list two Origin CA root fingerprints'
  rm -rf -- "$tmp_roots"
  [[ "$bundle_prints" == "$readme_prints" ]] || fail 'the Origin CA bundle fingerprints differ from deploy/README.md'
fi
# Django is reachable only through Caddy: no application slot publishes a port
# or shares another network namespace.
awk '
  /^[^[:space:]#]/ { top = $1; service = "" }
  top == "services:" && /^  [A-Za-z0-9_-]+:/ { service = $1 }
  top == "x-app:" && /^  (ports|network_mode):/ { bad = 1 }
  top == "services:" && service ~ /^app-/ && /^    (ports|network_mode):/ { bad = 1 }
  END { exit bad }
' "$compose" || fail 'an application slot publishes a port or sets network_mode; Django must be reachable only through Caddy'
for anchor in '^x-app:' '^  app-blue:' '^  app-green:'; do
  grep -Eq "$anchor" "$compose" || fail "the slot exposure check no longer finds $anchor"
done
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
cp "$compose" "$root/deploy/Caddyfile" "$root/deploy/runtime-images.lock" "$root/deploy/release_manifest.py" "$root/deploy/cloudflare-origin-ca.pem" "$bundle/deploy/"
cp "$routes" "$bundle/deploy/caddy/"
cp -R "$root/deploy/caddy/edge" "$bundle/deploy/caddy/"
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
    # Signals runtime.sh's whole process group, as a Ctrl-C or systemd stop would.
    [[ ! -e '__STATE__/term-compose' ]] || kill -TERM 0
    exit 0 ;;
  'image inspect')
    [[ "${STUB_FAIL_IMAGE:-0}" != 1 ]] || exit 1
    if [[ "$*" == *RepoDigests* && "${STUB_SHORT_REPO_DIGESTS:-0}" == 1 ]]; then
      # The short form a real Docker Engine reports for Docker Hub images.
      printf '%s\n' \
        'ghcr.io/example/mawareeth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
        'caddy@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52' \
        'postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3'
    elif [[ "$*" == *RepoDigests* && "${STUB_FOREIGN_REPO_DIGESTS:-0}" == 1 ]]; then
      # The locked digests under other repositories must not satisfy the lock.
      printf '%s\n' \
        'ghcr.io/example/mawareeth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
        'other/caddy@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52' \
        'docker.io/other/postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3'
    elif [[ "$*" == *RepoDigests* ]]; then
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
  # Some filesystems (Git Bash on NTFS) ignore chmod; report the fixture's mode.
  elif [[ "$3" == */origin-open || -e "$3.docker-made" ]]; then printf '0:0:755\n'
  elif [[ "$3" == */origin-open-key/key.pem ]]; then printf '0:0:644\n'
  elif [[ "$3" == */origin-not-root || "$3" == */origin-not-root-key/key.pem ]]; then
    mode="$('__STAT__' -c '%a' "$3")"; printf '1000:1000:%s\n' "$mode"
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
# The eight-key contract renders exactly the pre-existing snapshot, so hosts
# without the optional keys keep their snapshot file and hash.
cat > "$tmp/expected-eight.snapshot.env" <<'EOF'
DJANGO_ENV=production
DJANGO_DEBUG=False
DJANGO_KEY=a-long-django-$-#-quote-'-"-key-that-is-never-printed-123456
DJANGO_ALLOWED_HOSTS=example.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://example.com
DATABASE_URL=postgresql://mawareeth:LongUrlSafePassword_123456@postgres:5432/mawareeth
DATABASE_SSL_MODE=disable
MAILGUN_ACCESS_KEY=mailgun-secret-value
MAILGUN_SERVER_NAME=mg.example.com
EOF
cmp -s "$tmp/expected-eight.snapshot.env" "$first_snapshot" || fail 'the eight-key snapshot is not byte-identical to the established content'
[[ "$(basename "$first_snapshot")" == "$(sha256sum "$tmp/expected-eight.snapshot.env" | awk '{print $1}').snapshot.env" ]] \
  || fail 'the eight-key snapshot hash changed'

# Optional application keys: SITE_ID and the social-login credentials.
fb_secret='facebook-secret-value-never-printed'
li_key='linkedin-key-value-never-printed'
li_secret='linkedin-secret-value-never-printed'
eight_hash="$(sha256sum "$tmp/expected-eight.snapshot.env" | awk '{print $1}')"
# prepare_with NAME LINE... prepares a fresh state directory from the fixture
# plus LINEs and prints the combined output.
prepare_with() {
  local name="$1"; shift
  cp "${base_runtime:-$tmp/runtime.env}" "$tmp/$name.env"; (($# == 0)) || printf '%s\n' "$@" >> "$tmp/$name.env"; chmod 600 "$tmp/$name.env"
  TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/$name.env" \
    MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/$name-state" \
    MAWAREETH_ORIGIN_TLS_DIR="${origin_fixture:-$tmp/no-origin-tls}" bash "$runtime" prepare 2>&1
}
# cleanup_optional NAME removes a case's runtime file and state so a wrongly
# accepted case cannot affect later ones.
cleanup_optional() { rm -rf "$tmp/$1.env" "$tmp/$1-state"; }
assert_no_secret_leak() {
  [[ "$2" != *"$fb_secret"* && "$2" != *"$li_key"* && "$2" != *"$li_secret"* \
    && "$2" != *'LongUrlSafePassword_123456'* && "$2" != *'a-long-django-$-#-quote'* && "$2" != *'mailgun-secret-value'* ]] \
    || fail "$1 leaked a secret"
}
# expect_optional_refused LABEL MESSAGE BAD LINE...: refused before any state
# change, naming the key without echoing the BAD value.
expect_optional_refused() {
  local label="$1" message="$2" bad="$3" output; shift 3
  if output="$(prepare_with optional-bad "$@")"; then cleanup_optional optional-bad; fail "$label was accepted"; fi
  [[ "$output" == *"$message"* ]] || fail "$label refusal did not name the key: $output"
  [[ ! -e "$tmp/optional-bad-state" ]] || fail "$label created runtime state"
  assert_no_secret_leak "$label" "$output"
  [[ "$output" != *"$bad"* ]] || fail "$label echoed the refused value: $output"
  cleanup_optional optional-bad
}
# expect_optional_snapshot NAME EXPECTED_FILE LINE...: accepted, exactly one
# snapshot whose content matches and whose name is its own sha256, distinct
# from the eight-key hash.
expect_optional_snapshot() {
  local name="$1" expected="$2" output hash; shift 2
  output="$(prepare_with "$name" "$@")" || { cleanup_optional "$name"; fail "$name was refused: $output"; }
  assert_no_secret_leak "$name" "$output"
  snapshots=("$tmp/$name-state"/*.snapshot.env)
  [[ ${#snapshots[@]} == 1 && -f "${snapshots[0]}" ]] || fail "$name did not create exactly one snapshot"
  cmp -s "$expected" "${snapshots[0]}" || fail "$name snapshot content is wrong"
  hash="$(sha256sum "${snapshots[0]}" | awk '{print $1}')"
  [[ "$(basename "${snapshots[0]}")" == "$hash.snapshot.env" ]] || fail "$name snapshot is not named by its sha256"
  [[ "$hash" != "$eight_hash" ]] || fail "$name snapshot reused the eight-key hash"
  cleanup_optional "$name"
}
{ cat "$tmp/expected-eight.snapshot.env"
  printf '%s\n' SITE_ID=2 FACEBOOK_KEY=123456789012345 "FACEBOOK_SECRET=$fb_secret" "LINKEDIN_KEY=$li_key" "LINKEDIN_SECRET=$li_secret"
} > "$tmp/expected-all.snapshot.env"
# Given out of order; the snapshot uses the fixed order.
expect_optional_snapshot optional-all "$tmp/expected-all.snapshot.env" SITE_ID=2 "LINKEDIN_SECRET=$li_secret" \
  "FACEBOOK_SECRET=$fb_secret" FACEBOOK_KEY=123456789012345 "LINKEDIN_KEY=$li_key"
{ cat "$tmp/expected-eight.snapshot.env"; printf 'SITE_ID=2\n'; } > "$tmp/expected-site.snapshot.env"
expect_optional_snapshot optional-site "$tmp/expected-site.snapshot.env" SITE_ID=2
# Upper boundaries are accepted.
max_fb_key="$(printf '9%.0s' {1..32})"
max_secret="$fb_secret$(printf 'y%.0s' $(seq $((256 - ${#fb_secret}))))"
max_li_key="$li_key$(printf 'k%.0s' $(seq $((256 - ${#li_key}))))"
max_li_secret="$li_secret$(printf 's%.0s' $(seq $((256 - ${#li_secret}))))"
[[ ${#max_secret} == 256 && ${#max_li_key} == 256 && ${#max_li_secret} == 256 ]] || fail 'boundary fixtures are not 256 characters'
{ cat "$tmp/expected-eight.snapshot.env"
  printf '%s\n' SITE_ID=2147483647 "FACEBOOK_KEY=$max_fb_key" "FACEBOOK_SECRET=$max_secret" "LINKEDIN_KEY=$max_li_key" "LINKEDIN_SECRET=$max_li_secret"
} > "$tmp/expected-max.snapshot.env"
expect_optional_snapshot optional-max "$tmp/expected-max.snapshot.env" SITE_ID=2147483647 "FACEBOOK_KEY=$max_fb_key" \
  "FACEBOOK_SECRET=$max_secret" "LINKEDIN_KEY=$max_li_key" "LINKEDIN_SECRET=$max_li_secret"
for bad in 0 -1 abc 01 12345678901 2147483648; do
  expect_optional_refused "SITE_ID=$bad" 'SITE_ID' "$bad" "SITE_ID=$bad"
done
for bad in abc 12a -5 "$(printf '1%.0s' {1..33})"; do
  expect_optional_refused "FACEBOOK_KEY=$bad" 'FACEBOOK_KEY' "$bad" "FACEBOOK_KEY=$bad" "FACEBOOK_SECRET=$fb_secret"
done
expect_optional_refused 'FACEBOOK_KEY without FACEBOOK_SECRET' 'FACEBOOK_KEY and FACEBOOK_SECRET' 123 FACEBOOK_KEY=123
expect_optional_refused 'FACEBOOK_SECRET without FACEBOOK_KEY' 'FACEBOOK_KEY and FACEBOOK_SECRET' "$fb_secret" "FACEBOOK_SECRET=$fb_secret"
expect_optional_refused 'LINKEDIN_KEY without LINKEDIN_SECRET' 'LINKEDIN_KEY and LINKEDIN_SECRET' "$li_key" "LINKEDIN_KEY=$li_key"
expect_optional_refused 'LINKEDIN_SECRET without LINKEDIN_KEY' 'LINKEDIN_KEY and LINKEDIN_SECRET' "$li_secret" "LINKEDIN_SECRET=$li_secret"
expect_optional_refused 'overlong FACEBOOK_SECRET' 'FACEBOOK_SECRET' "${max_secret}x" FACEBOOK_KEY=123 "FACEBOOK_SECRET=${max_secret}x"
expect_optional_refused 'overlong LINKEDIN_KEY' 'LINKEDIN_KEY' "${max_li_key}x" "LINKEDIN_KEY=${max_li_key}x" "LINKEDIN_SECRET=$li_secret"
expect_optional_refused 'overlong LINKEDIN_SECRET' 'LINKEDIN_SECRET' "${max_li_secret}x" "LINKEDIN_KEY=$li_key" "LINKEDIN_SECRET=${max_li_secret}x"
expect_optional_refused 'whitespace in FACEBOOK_SECRET' 'FACEBOOK_SECRET' "$fb_secret x" FACEBOOK_KEY=123 "FACEBOOK_SECRET=$fb_secret x"
expect_optional_refused 'whitespace in LINKEDIN_KEY' 'LINKEDIN_KEY' "$li_key x" "LINKEDIN_KEY=$li_key x" "LINKEDIN_SECRET=$li_secret"
expect_optional_refused 'whitespace in LINKEDIN_SECRET' 'LINKEDIN_SECRET' "$li_secret x" "LINKEDIN_KEY=$li_key" "LINKEDIN_SECRET=$li_secret x"

# Edge keys (EDGE_MODE, REDIRECT_DOMAIN) configure Caddy only: they never enter
# the app snapshot. The cloudflare cases use the production shape: DOMAIN is
# www.example.com and REDIRECT_DOMAIN is example.com.
sed 's/^DOMAIN=example\.com$/DOMAIN=www.example.com/' "$tmp/runtime.env" > "$tmp/runtime-www.env"; chmod 600 "$tmp/runtime-www.env"
sed 's/^DJANGO_ALLOWED_HOSTS=example\.com$/DJANGO_ALLOWED_HOSTS=www.example.com/; s|^DJANGO_CSRF_TRUSTED_ORIGINS=https://example\.com$|DJANGO_CSRF_TRUSTED_ORIGINS=https://www.example.com|' \
  "$tmp/expected-eight.snapshot.env" > "$tmp/expected-www.snapshot.env"
grep -qx 'DJANGO_ALLOWED_HOSTS=www.example.com' "$tmp/expected-www.snapshot.env" || fail 'could not render the www snapshot fixture'
# origin_pair DIR SANS [expired] writes a self-signed certificate for SANS
# (subjectAltName syntax) and its key to DIR/cert.pem and DIR/key.pem. OpenSSL
# runs in a scratch directory with relative paths only.
origin_pair() {
  local dir="$1" sans="$2" when="${3:-current}" work
  work="$(mktemp -d)"
  (
    cd "$work" || exit 1
    printf '%s\n' '[req]' 'prompt = no' 'distinguished_name = dn' '[dn]' 'CN = origin.invalid' \
      '[ca]' 'default_ca = fixture' '[fixture]' 'database = index.txt' 'new_certs_dir = .' 'serial = serial' \
      'default_md = sha256' 'policy = anything' 'copy_extensions = copy' 'unique_subject = no' \
      '[anything]' 'commonName = supplied' > openssl.cnf
    : > index.txt; printf '01\n' > serial
    if [[ "$when" == expired ]]; then
      openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -config openssl.cnf \
        -addext "subjectAltName=$sans" -keyout key.pem -out request.csr
      openssl ca -batch -config openssl.cnf -selfsign -keyfile key.pem -in request.csr \
        -startdate 20200101000000Z -enddate 20200102000000Z -notext -out cert.pem
    else
      openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 -config openssl.cnf \
        -addext "subjectAltName=$sans" -keyout key.pem -out cert.pem
    fi
  ) >/dev/null 2>&1 || fail 'could not generate an Origin certificate fixture'
  mkdir -p "$dir"; cp "$work/cert.pem" "$work/key.pem" "$dir/"; rm -rf "$work"
}
if ((have_openssl)); then
  origin_pair "$tmp/pair-good" 'DNS:example.com,DNS:*.example.com'
  origin_pair "$tmp/pair-other" 'DNS:example.com,DNS:*.example.com'
  origin_pair "$tmp/pair-expired" 'DNS:example.com,DNS:*.example.com' expired
  origin_pair "$tmp/pair-www-only" 'DNS:www.example.com'
  # A line of the private key: no output may ever contain it.
  key_material="$(sed -n 2p "$tmp/pair-good/key.pem")"
  [[ -n "$key_material" ]] || fail 'the Origin key fixture is empty'
else
  mkdir -p "$tmp/pair-good"
  printf 'origin certificate\n' > "$tmp/pair-good/cert.pem"; printf 'ORIGIN-KEY-MATERIAL-never-printed\n' > "$tmp/pair-good/key.pem"
  key_material='ORIGIN-KEY-MATERIAL-never-printed'
fi
# make_origin DIR [PAIR] creates an Origin certificate directory from PAIR
# (default: the valid pair) with the modes the runtime requires.
make_origin() {
  rm -rf "$1"; mkdir -p "$1"
  cp "${2:-$tmp/pair-good}/cert.pem" "${2:-$tmp/pair-good}/key.pem" "$1/"
  chmod 700 "$1"; chmod 644 "$1/cert.pem"; chmod 600 "$1/key.pem"
}
# expect_edge_snapshot NAME EXPECTED LINE...: accepted with exactly the
# EXPECTED snapshot, named by its own sha256.
expect_edge_snapshot() {
  local name="$1" expected="$2" output; shift 2
  output="$(prepare_with "$name" "$@")" || { cleanup_optional "$name"; fail "$name was refused: $output"; }
  assert_no_secret_leak "$name" "$output"
  [[ "$output" != *"$key_material"* ]] || fail "$name printed Origin key material"
  snapshots=("$tmp/$name-state"/*.snapshot.env)
  [[ ${#snapshots[@]} == 1 && "$(basename "${snapshots[0]}")" == "$(sha256sum "$expected" | awk '{print $1}').snapshot.env" ]] \
    || fail "$name changed the snapshot name"
  cmp -s "$expected" "${snapshots[0]}" || fail "$name changed the snapshot content"
  ! grep -Eq '^(EDGE_MODE|REDIRECT_DOMAIN)=' "${snapshots[0]}" || fail "$name put edge keys into the app snapshot"
}
# expect_edge_refused LABEL MESSAGE LINE...: refused before any state change,
# naming MESSAGE (a key or path) and never printing the Origin key.
expect_edge_refused() {
  local label="$1" message="$2"; shift 2
  expect_optional_refused "$label" "$message" "$key_material" "$@"
}
expect_edge_snapshot edge-acme "$tmp/expected-eight.snapshot.env" EDGE_MODE=acme
need "$tmp/compose.env" 'EDGE_MODE=acme'
need "$tmp/compose.env" "EDGE_TLS_DIR=$tmp/edge-acme-state/edge-tls"
grep -qx 'REDIRECT_DOMAIN=' "$tmp/compose.env" || fail 'acme mode passed a redirect name to Compose'
[[ -d "$tmp/edge-acme-state/edge-tls" && -z "$(ls -A "$tmp/edge-acme-state/edge-tls")" ]] || fail 'acme prepare did not create the empty edge placeholder'
# Docker creates a missing bind source as an empty root 0755 directory; prepare
# accepts that placeholder too ($path.docker-made makes the stat stub report it).
rmdir "$tmp/edge-acme-state/edge-tls"; mkdir "$tmp/edge-acme-state/edge-tls"; chmod 755 "$tmp/edge-acme-state/edge-tls"
touch "$tmp/edge-acme-state/edge-tls.docker-made"
TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/edge-acme.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/edge-acme-state" bash "$runtime" prepare >/dev/null 2>&1 \
  || fail 'prepare refused an empty root 0755 edge placeholder created by Docker'
cleanup_optional edge-acme
base_runtime="$tmp/runtime-www.env"
expect_edge_snapshot edge-acme-www "$tmp/expected-www.snapshot.env"
cleanup_optional edge-acme-www
cloudflare_lines=(EDGE_MODE=cloudflare REDIRECT_DOMAIN=example.com)
if ((have_openssl)); then
  # The cloudflare snapshot is the acme snapshot for the same DOMAIN.
  origin_fixture="$tmp/origin-tls"; make_origin "$origin_fixture"
  expect_edge_snapshot edge-cloudflare "$tmp/expected-www.snapshot.env" "${cloudflare_lines[@]}"
  need "$tmp/compose.env" 'EDGE_MODE=cloudflare'
  need "$tmp/compose.env" 'REDIRECT_DOMAIN=example.com'
  need "$tmp/compose.env" 'DOMAIN=www.example.com'
  need "$tmp/compose.env" "EDGE_TLS_DIR=$origin_fixture"
  ! grep -Fq "$key_material" "$tmp/compose.env" || fail 'Origin key material reached the Compose environment'
  [[ ! -e "$tmp/edge-cloudflare-state/edge-tls" ]] || fail 'cloudflare prepare created the acme placeholder'
  cleanup_optional edge-cloudflare
fi
base_runtime=''
for bad in other Cloudflare ACME; do
  expect_edge_refused "EDGE_MODE=$bad" 'EDGE_MODE must be acme or cloudflare' "EDGE_MODE=$bad"
done
expect_edge_refused 'cloudflare without REDIRECT_DOMAIN' 'REDIRECT_DOMAIN is required' EDGE_MODE=cloudflare
expect_edge_refused 'REDIRECT_DOMAIN equal to DOMAIN' 'REDIRECT_DOMAIN must differ' EDGE_MODE=cloudflare REDIRECT_DOMAIN=example.com
for bad in bad_name.example.com localhost Www.example.com -www.example.com www..example.com; do
  expect_optional_refused "REDIRECT_DOMAIN=$bad" 'REDIRECT_DOMAIN' "$bad" EDGE_MODE=cloudflare "REDIRECT_DOMAIN=$bad"
done
expect_edge_refused 'REDIRECT_DOMAIN without EDGE_MODE' 'REDIRECT_DOMAIN is supported only with EDGE_MODE=cloudflare' REDIRECT_DOMAIN=www.example.com
expect_edge_refused 'REDIRECT_DOMAIN with EDGE_MODE=acme' 'REDIRECT_DOMAIN is supported only with EDGE_MODE=cloudflare' EDGE_MODE=acme REDIRECT_DOMAIN=www.example.com
# Origin files: each defect is refused before any state change, naming the path.
base_runtime="$tmp/runtime-www.env"
origin_fixture="$tmp/origin-missing"; rm -rf "$origin_fixture"
expect_edge_refused 'a missing Origin directory' "$origin_fixture" "${cloudflare_lines[@]}"
origin_fixture="$tmp/origin-open"; make_origin "$origin_fixture"; chmod 755 "$origin_fixture"
expect_edge_refused 'an Origin directory not mode 0700' "$origin_fixture must be owned by root:root with mode 0700" "${cloudflare_lines[@]}"
origin_fixture="$tmp/origin-no-cert"; make_origin "$origin_fixture"; rm -f "$origin_fixture/cert.pem"
expect_edge_refused 'a missing Origin certificate' "$origin_fixture/cert.pem" "${cloudflare_lines[@]}"
origin_fixture="$tmp/origin-empty-cert"; make_origin "$origin_fixture"; : > "$origin_fixture/cert.pem"
expect_edge_refused 'an empty Origin certificate' "$origin_fixture/cert.pem" "${cloudflare_lines[@]}"
origin_fixture="$tmp/origin-cert-dir"; make_origin "$origin_fixture"; rm -f "$origin_fixture/cert.pem"; mkdir "$origin_fixture/cert.pem"
expect_edge_refused 'an Origin certificate that is not a regular file' "$origin_fixture/cert.pem" "${cloudflare_lines[@]}"
origin_fixture="$tmp/origin-no-key"; make_origin "$origin_fixture"; rm -f "$origin_fixture/key.pem"
expect_edge_refused 'a missing Origin key' "$origin_fixture/key.pem" "${cloudflare_lines[@]}"
origin_fixture="$tmp/origin-open-key"; make_origin "$origin_fixture"; chmod 644 "$origin_fixture/key.pem"
expect_edge_refused 'an Origin key not mode 0600' "$origin_fixture/key.pem must be owned by root:root with mode 600" "${cloudflare_lines[@]}"
origin_fixture="$tmp/origin-link-key"; make_origin "$origin_fixture"; mv "$origin_fixture/key.pem" "$tmp/origin-real-key.pem"
ln -s "$tmp/origin-real-key.pem" "$origin_fixture/key.pem"
if [[ -L "$origin_fixture/key.pem" ]]; then
  expect_edge_refused 'a symlinked Origin key' "$origin_fixture/key.pem" "${cloudflare_lines[@]}"
fi
origin_fixture="$tmp/origin-not-root"; make_origin "$origin_fixture"
[[ ${EUID:-999} -ne 0 ]] || chown 1000:1000 "$origin_fixture"
expect_edge_refused 'an Origin directory not owned by root' "$origin_fixture must be owned by root:root" "${cloudflare_lines[@]}"
origin_fixture="$tmp/origin-not-root-key"; make_origin "$origin_fixture"
[[ ${EUID:-999} -ne 0 ]] || chown 1000:1000 "$origin_fixture/key.pem"
expect_edge_refused 'an Origin key not owned by root' "$origin_fixture/key.pem must be owned by root:root" "${cloudflare_lines[@]}"
# The pinned Origin CA roots must ship with the deployment bundle.
origin_fixture="$tmp/origin-tls"; make_origin "$origin_fixture"
mv "$bundle/deploy/cloudflare-origin-ca.pem" "$tmp/origin-ca.moved"
expect_edge_refused 'a missing Origin CA bundle' "Origin CA bundle $bundle/deploy/cloudflare-origin-ca.pem is missing" "${cloudflare_lines[@]}"
mv "$tmp/origin-ca.moved" "$bundle/deploy/cloudflare-origin-ca.pem"
# Certificate content, checked with openssl before any state change.
if ((have_openssl)); then
  origin_fixture="$tmp/origin-not-pem"; make_origin "$origin_fixture"; printf 'not a certificate\n' > "$origin_fixture/cert.pem"
  expect_edge_refused 'a non-PEM Origin certificate' "origin certificate $origin_fixture/cert.pem is not a PEM X.509 certificate" "${cloudflare_lines[@]}"
  origin_fixture="$tmp/origin-expired"; make_origin "$origin_fixture" "$tmp/pair-expired"
  expect_edge_refused 'an expired Origin certificate' "origin certificate $origin_fixture/cert.pem has expired" "${cloudflare_lines[@]}"
  origin_fixture="$tmp/origin-www-only"; make_origin "$origin_fixture" "$tmp/pair-www-only"
  expect_edge_refused 'an Origin certificate without REDIRECT_DOMAIN' "origin certificate $origin_fixture/cert.pem does not cover REDIRECT_DOMAIN" "${cloudflare_lines[@]}"
  origin_fixture="$tmp/origin-wrong-key"; make_origin "$origin_fixture"; cp "$tmp/pair-other/key.pem" "$origin_fixture/key.pem"; chmod 600 "$origin_fixture/key.pem"
  expect_edge_refused 'a mismatched Origin key' "origin key $origin_fixture/key.pem does not match origin certificate $origin_fixture/cert.pem" "${cloudflare_lines[@]}"
  [[ "$(sed -n 2p "$tmp/pair-other/key.pem")" != "$key_material" ]] || fail 'the mismatched key fixture equals the valid key'
fi
base_runtime=''; origin_fixture=''

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
need "$tmp/compose.env" 'EDGE_MODE=acme'
need "$tmp/compose.env" "EDGE_TLS_DIR=$tmp/runtime/edge-tls"
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

# The acme placeholder stands in for the Origin certificate directory and must
# stay empty, so nothing is ever mounted there by accident.
touch "$tmp/runtime/edge-tls/key.pem"
expect_up_refused 'a non-empty acme edge placeholder' 'edge-tls must be empty with EDGE_MODE=acme'
rm -f "$tmp/runtime/edge-tls/key.pem"
# An empty root 0755 placeholder, as Docker creates a missing bind source, is
# accepted by up and prepare.
rmdir "$tmp/runtime/edge-tls"; mkdir "$tmp/runtime/edge-tls"; chmod 755 "$tmp/runtime/edge-tls"; touch "$tmp/runtime/edge-tls.docker-made"
run_runtime up >/dev/null 2>&1 || fail 'runtime up refused an empty root 0755 edge placeholder'
run_runtime prepare >/dev/null 2>&1 || fail 'runtime prepare refused an empty root 0755 edge placeholder'
rm -f "$tmp/runtime/edge-tls.docker-made"; chmod 700 "$tmp/runtime/edge-tls"

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

STUB_SHORT_REPO_DIGESTS=1 TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/short-digests" bash "$runtime" prepare >/dev/null 2>&1 \
  || fail 'short Docker Hub repository digests were refused'
rm -rf "$tmp/short-digests"
if STUB_FOREIGN_REPO_DIGESTS=1 TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/foreign-digests" bash "$runtime" prepare >/dev/null 2>&1; then
  fail 'a locked digest under a foreign repository was accepted'
fi
[[ ! -e "$tmp/foreign-digests" ]] || fail 'a foreign repository digest mutated snapshot state'

printf 'drift\n' > "$first_snapshot"
if run_runtime prepare >/dev/null 2>&1; then fail 'snapshot content drift was accepted'; fi
rm -rf "$tmp/runtime"
run_runtime prepare >/dev/null

rm -rf "$tmp/pre-compose-state"; : > "$state/fail-compose"
before_mutations="$(grep -Ec 'volume create|compose --project-name.* up' "$tmp/docker.log" 2>/dev/null || true)"
rm -rf "$tmp/validate-tmp"; mkdir -p "$tmp/validate-tmp"
if TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" TMPDIR="$tmp/validate-tmp" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/pre-compose-state" bash "$runtime" prepare >"$tmp/validate.out" 2>&1; then
  fail 'invalid resolved Compose model was accepted'
fi
rm -f "$state/fail-compose"
need "$tmp/validate.out" 'the resolved Compose model is invalid'
[[ -z "$(ls -A "$tmp/validate-tmp")" ]] || fail 'Compose validation failure left its secret-bearing temporary snapshot'
[[ ! -e "$tmp/pre-compose-state" ]] || fail 'Compose validation failure published persistent state'

# A failure while publishing the snapshot removes the atomic temporary file.
mkdir -p "$tmp/chown-fail-bin"
printf '#!/usr/bin/env bash\n[[ "${*: -1}" != */.snapshot.* ]]\n' > "$tmp/chown-fail-bin/chown"
chmod +x "$tmp/chown-fail-bin/chown"
rm -rf "$tmp/publish-fail-state"
if TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$tmp/chown-fail-bin:$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/publish-fail-state" bash "$runtime" prepare >"$tmp/publish.out" 2>&1; then
  fail 'a snapshot that could not be protected was accepted'
fi
need "$tmp/publish.out" 'could not protect runtime snapshot'
[[ -z "$(find "$tmp/publish-fail-state" -name '.snapshot.*' -print -quit 2>/dev/null)" ]] || fail 'snapshot publication failure left its secret-bearing temporary file'

# A failure while protecting the validation snapshot also removes it.
mkdir -p "$tmp/chmod-fail-bin"
printf '#!/usr/bin/env bash\n[[ "${*: -1}" == */app.snapshot.env ]] && exit 1\nexec %q "$@"\n' "$(command -v chmod)" > "$tmp/chmod-fail-bin/chmod"
"$(command -v chmod)" +x "$tmp/chmod-fail-bin/chmod"
rm -rf "$tmp/validate-tmp" "$tmp/chmod-fail-state"; mkdir -p "$tmp/validate-tmp"
if TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$tmp/chmod-fail-bin:$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" TMPDIR="$tmp/validate-tmp" \
  MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$tmp/chmod-fail-state" bash "$runtime" prepare >"$tmp/validate.out" 2>&1; then
  fail 'an unprotected validation snapshot was accepted'
fi
need "$tmp/validate.out" 'could not protect temporary Compose validation snapshot'
[[ -z "$(ls -A "$tmp/validate-tmp")" ]] || fail 'validation setup failure left its secret-bearing temporary snapshot'
[[ "$(grep -Ec 'volume create|compose --project-name.* up' "$tmp/docker.log" 2>/dev/null || true)" == "$before_mutations" ]] || fail 'Compose validation failure mutated Docker state'

# TERM inside either temporary window: the secret-bearing file is removed
# first, then runtime.sh ends by the signal. runtime.sh runs as a job in its
# own process group (set -m), so the stubs' `kill -TERM 0` reaches only it.
signal_rc=0
prepare_in_own_group() {
  signal_rc=0
  set -m
  TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$1:$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" TMPDIR="$tmp/validate-tmp" \
    MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$2" bash "$runtime" prepare >"$tmp/signal.out" 2>&1 &
  wait "$!" || signal_rc=$?
  set +m
}
mkdir -p "$tmp/no-extra-bin"
rm -rf "$tmp/validate-tmp" "$tmp/term-validate-state"; mkdir -p "$tmp/validate-tmp"; : > "$state/term-compose"
prepare_in_own_group "$tmp/no-extra-bin" "$tmp/term-validate-state"
rm -f "$state/term-compose"
[[ "$signal_rc" == 143 ]] || fail "TERM during Compose validation did not end runtime.sh by TERM (status $signal_rc)"
[[ -z "$(ls -A "$tmp/validate-tmp")" ]] || fail 'TERM during Compose validation left its secret-bearing temporary snapshot'
[[ ! -e "$tmp/term-validate-state" ]] || fail 'TERM during Compose validation published persistent state'

mkdir -p "$tmp/term-chown-bin"
printf '#!/usr/bin/env bash\n[[ "${*: -1}" != */.snapshot.* ]] || kill -TERM 0\n' > "$tmp/term-chown-bin/chown"
chmod +x "$tmp/term-chown-bin/chown"
rm -rf "$tmp/term-publish-state"
prepare_in_own_group "$tmp/term-chown-bin" "$tmp/term-publish-state"
[[ "$signal_rc" == 143 ]] || fail "TERM during snapshot publication did not end runtime.sh by TERM (status $signal_rc)"
[[ -d "$tmp/term-publish-state" ]] || fail 'the snapshot publication signal test never reached its window'
[[ -z "$(find "$tmp/term-publish-state" -name '.snapshot.*' -print -quit)" ]] || fail 'TERM during snapshot publication left its secret-bearing temporary file'
[[ -z "$(find "$tmp/term-publish-state" -name '*.snapshot.env' -print -quit)" ]] || fail 'TERM during snapshot publication still published the snapshot'

# Sourced, as release.sh does: a signal inside the window runs the caller's
# trap once after the window; without one the traps come back unchanged; an
# ignored signal stays ignored.
signal_out="$(bash -c 'source "$1"; trap "echo caller-trap" TERM; runtime_defer_signals; kill -TERM "$BASHPID"; echo deferred
  runtime_release_signals; echo after; trap -p TERM' _ "$runtime" 2>&1)" || fail 'the sourced signal window failed'
[[ "$signal_out" == $'deferred\ncaller-trap\nafter\ntrap -- \'echo caller-trap\' SIGTERM' ]] || fail "the caller's TERM trap did not run once after the window: $signal_out"
bash -c 'source "$1"; trap "exit 143" TERM; trap "" INT; before="$(trap -p INT TERM HUP)"; runtime_defer_signals; runtime_release_signals
  [[ "$(trap -p INT TERM HUP)" == "$before" ]]' _ "$runtime" || fail 'a window without signals changed the caller traps'
signal_out="$(bash -c 'source "$1"; trap "" TERM; runtime_defer_signals; trap -p TERM; kill -TERM "$BASHPID"; echo survived
  runtime_release_signals; echo released; trap -p TERM' _ "$runtime" 2>&1)" || fail 'an ignored TERM ended the sourced window'
[[ "$signal_out" == $'trap -- \'\' SIGTERM\nsurvived\nreleased\ntrap -- \'\' SIGTERM' ]] || fail "an ignored TERM did not stay ignored: $signal_out"

assert_path_rejected_without_mutation() {
  local label="$1" runtime_path="$2" state_path="$3" before output
  before="$(grep -Ec 'volume create|compose --project-name.* up' "$tmp/docker.log" 2>/dev/null || true)"
  if output="$(TEST_LOG="$tmp/docker.log" TEST_STATE="$state" PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$runtime_path" \
    MAWAREETH_RELEASE_MANIFEST="$tmp/manifest.json" MAWAREETH_RUNTIME_DIR="$state_path" bash "$runtime" prepare 2>&1)"; then
    fail "$label was accepted"
  fi
  [[ "$(grep -Ec 'volume create|compose --project-name.* up' "$tmp/docker.log" 2>/dev/null || true)" == "$before" ]] || fail "$label caused Docker mutation"
  assert_no_secret_leak "$label" "$output"
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
  # real_compose_config DOMAIN EDGE_MODE REDIRECT_DOMAIN EDGE_TLS_DIR ARGS...
  real_compose_config() {
    local domain="$1" mode="$2" redirect="$3" tls_dir="$4"; shift 4
    APP_BLUE_IMAGE="ghcr.io/example/mawareeth@$app_digest" APP_GREEN_IMAGE="ghcr.io/example/mawareeth@$app_digest" ROUTES_DIR="$tmp/runtime/routes" APP_SNAPSHOT="$first_snapshot" DOMAIN="$domain" \
      EDGE_MODE="$mode" REDIRECT_DOMAIN="$redirect" EDGE_TLS_DIR="$tls_dir" \
      POSTGRES_DB=mawareeth POSTGRES_USER=mawareeth POSTGRES_PASSWORD=offline-placeholder \
      CADDY_IMAGE='docker.io/library/caddy:2.11.4@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52' \
      POSTGRES_IMAGE='docker.io/library/postgres:17.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3' \
      "$real_docker" compose --project-name mawareeth -f "$compose" config "$@"
  }
  real_compose_config example.com acme '' "$tmp/runtime/edge-tls" --quiet || fail 'the acme Compose model is invalid'
  mkdir -p "$tmp/origin-tls"
  # Only Caddy receives the edge settings and the Origin certificate mount.
  for mode in acme cloudflare; do
    if [[ "$mode" == acme ]]; then
      real_compose_config example.com acme '' "$tmp/runtime/edge-tls" --format json > "$tmp/compose-$mode.json" || fail 'cannot render the acme Compose model'
    else
      real_compose_config www.example.com cloudflare example.com "$tmp/origin-tls" --format json > "$tmp/compose-$mode.json" || fail 'cannot render the cloudflare Compose model'
    fi
    python3 - "$mode" "$tmp/compose-$mode.json" <<'PY' || fail "the $mode Compose model wires the edge settings wrongly"
import json
import sys

mode, path = sys.argv[1], sys.argv[2]
services = json.load(open(path, encoding="utf-8")).get("services", {})
problems = []
caddy = services.get("caddy", {})
environment = caddy.get("environment") or {}
if environment.get("EDGE_MODE") != mode:
    problems.append("caddy lacks EDGE_MODE=" + mode)
if mode == "cloudflare" and environment.get("REDIRECT_DOMAIN") != "example.com":
    problems.append("caddy lacks REDIRECT_DOMAIN")
if mode == "acme" and environment.get("REDIRECT_DOMAIN") not in (None, ""):
    problems.append("acme caddy received a REDIRECT_DOMAIN")
binds = [volume for volume in caddy.get("volumes") or [] if volume.get("target") == "/etc/caddy/origin-tls"]
suffix = "origin-tls" if mode == "cloudflare" else "edge-tls"
if len(binds) != 1:
    problems.append("caddy must mount exactly one directory at /etc/caddy/origin-tls")
else:
    bind = binds[0]
    if bind.get("type") != "bind" or bind.get("read_only") is not True:
        problems.append("the origin-tls mount must be a read-only bind")
    if not str(bind.get("source", "")).replace("\\", "/").rstrip("/").endswith("/" + suffix):
        problems.append("the origin-tls mount source is not the " + suffix + " directory")
for name, service in services.items():
    if name == "caddy":
        continue
    leaked = {"EDGE_MODE", "REDIRECT_DOMAIN", "EDGE_TLS_DIR"} & set(service.get("environment") or {})
    if leaked:
        problems.append(name + " received " + ", ".join(sorted(leaked)))
    if any(volume.get("target") == "/etc/caddy/origin-tls" for volume in service.get("volumes") or []):
        problems.append(name + " mounts the Origin certificate directory")
for problem in problems:
    print("FAIL: " + problem, file=sys.stderr)
sys.exit(1 if problems else 0)
PY
  done
fi

printf '%s\n' 'compose runtime offline checks passed'
