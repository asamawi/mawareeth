#!/usr/bin/env bash
# shellcheck disable=SC2016 # literal $ patterns are intentional in assertions.
# Offline tests for deploy/release.sh and its runtime.sh integration. Docker,
# curl and (when absent) flock are stubbed; nothing touches the network, a
# registry, host Docker state, or this checkout.
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
fail() { printf 'FAIL: %s\n' "$*" >&2; [[ ! -f "${tmp:-}/out" ]] || sed 's/^/  | /' "$tmp/out" >&2; exit 1; }
need() { grep -Fq -- "$2" "$1" || fail "missing $2 in $1"; }

bash -n "$root/deploy/release.sh" "$root/deploy/runtime.sh" "$0"
grep -Fq 'atomic_write "$route_file"' "$root/deploy/release.sh" || fail 'route switch must use the atomic writer'
! grep -Eq 'migrate [a-z_]+ (zero|[0-9]{4})|--fake' "$root/deploy/release.sh" || fail 'deploy must never reverse or fake migrations'
! grep -Eq -- '(^|[[:space:]])(-k|--insecure)([[:space:]]|$)' "$root/deploy/release.sh" || fail 'TLS verification must validate certificates'
! grep -Eq '^[[:space:]]+- "?[0-9.:]*2019' "$root/deploy/compose.yaml" || fail 'the Caddy admin port must never be published'

# Resolve the real tools before any stub shadows them.
real_mv="$(command -v mv)"; real_stat="$(command -v stat)"; real_install="$(command -v install)"
real_flock="$(command -v flock 2>/dev/null || true)"; real_sync="$(command -v sync)"

tmp="$(mktemp -d)"; [[ -z "${KEEP_TMP:-}" ]] || echo "$tmp" >&2
case "$tmp" in "$root"/*) fail 'temporary directory must be outside the checkout' ;; esac
trap '[[ -n "${KEEP_TMP:-}" ]] || rm -rf "$tmp"' EXIT
stub="$tmp/bin"; S="$tmp/docker-state"; state="$tmp/state"; bundle="$tmp/bundle"
mkdir -p "$stub" "$S" "$bundle/deploy/caddy"

# A disposable deployment bundle in its own Git repository with two release
# commits, so each manifest's bundle SHA matches the checked-out commit. Only
# the root execution gate is relaxed when the test itself is unprivileged.
cp "$root/deploy/compose.yaml" "$root/deploy/Caddyfile" "$root/deploy/runtime-images.lock" "$root/deploy/release_manifest.py" \
  "$root/deploy/cloudflare-origin-ca.pem" "$bundle/deploy/"
cp "$root/deploy/caddy/active-slot.caddy" "$bundle/deploy/caddy/"
cp -R "$root/deploy/caddy/edge" "$bundle/deploy/caddy/"
cp "$root/.gitignore" "$bundle/.gitignore"
for script in runtime.sh release.sh; do
  if [[ ${EUID:-999} -ne 0 ]]; then
    sed 's/\[\[ ${EUID:-999} -eq 0 \]\]/[[ 0 -eq 0 ]]/' "$root/deploy/$script" > "$bundle/deploy/$script"
    ! grep -Fq 'EUID' "$bundle/deploy/$script" || fail "root-gate patch was not applied to $script"
    grep -Fq '[[ 0 -eq 0 ]]' "$bundle/deploy/$script" || fail "root-gate patch was not applied to $script"
  else
    cp "$root/deploy/$script" "$bundle/deploy/$script"
  fi
done
g() { git -C "$bundle" -c user.name=test -c user.email=test@example.invalid -c core.autocrlf=false -c commit.gpgsign=false "$@"; }
g init -q
g config core.filemode false
g add -A
g commit -q -m 'release a'
commit_a="$(g rev-parse HEAD)"
g commit -q --allow-empty -m 'release b'
commit_b="$(g rev-parse HEAD)"
[[ "$commit_a" != "$commit_b" ]] || fail 'test releases must use different commits'
use_bundle() { g checkout -q --detach "$1"; }
runtime="$bundle/deploy/runtime.sh"; release="$bundle/deploy/release.sh"

digest_a='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
digest_b='sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
image_a="ghcr.io/example/mawareeth@$digest_a"
image_b="ghcr.io/example/mawareeth@$digest_b"
printf '%s %s\n%s %s\n' "$image_a" "$commit_a" "$image_b" "$commit_b" > "$S/image-commits"
manifest() {
  cat > "$tmp/$1.json" <<EOF
{"manifest_version":1,"release":{"version":"$3","commit_sha":"$3"},"application":{"image":"ghcr.io/example/mawareeth@$2","digest":"$2"},"deployment_bundle":{"git_sha":"$3"},"configuration":{"schema_version":"1"},"database":{"migration_contract":"expand-migrate-contract-v1"},"ci":{"workflow":"Django CI","workflow_run_id":"1"}}
EOF
  chmod 600 "$tmp/$1.json"
}
manifest manifest-a "$digest_a" "$commit_a"
manifest manifest-b "$digest_b" "$commit_b"
manifest manifest-b-at-a "$digest_b" "$commit_a"
cat > "$tmp/runtime.env" <<'EOF'
DOMAIN=example.com
APP_IMAGE_REPOSITORY=ghcr.io/example/mawareeth
POSTGRES_DB=mawareeth
POSTGRES_USER=mawareeth
POSTGRES_PASSWORD=LongUrlSafePassword_123456
DJANGO_KEY=a-long-django-key-that-is-never-printed-1234567890
MAILGUN_ACCESS_KEY=mailgun-secret-value
MAILGUN_SERVER_NAME=mg.example.com
EOF
chmod 600 "$tmp/runtime.env"


# Docker stub: records calls and models containers, image IDs, the Caddy-loaded
# route, Caddy's Compose config hash, and per-slot health from marker files in
# $S. A marker holding a number N fails (or acts) N more times.
cat > "$stub/docker" <<'EOF'
#!/usr/bin/env bash
S='__S__'
printf 'docker %s\n' "$*" >> "$S/calls.log"
commit_of() { awk -v image="$1" '$1 == image { print $2 }' "$S/image-commits"; }
image_id() { case "$1" in *aaaaaaaa*) printf 'sha256:%064d\n' 1 ;; *cccccccc*) printf 'sha256:%064d\n' 2 ;; *) printf 'sha256:%064d\n' 9 ;; esac; }
consume() {
  local file="$S/$1" count
  [[ -e "$file" ]] || return 1
  count="$(< "$file")"; ((count > 0)) || return 1
  printf '%s\n' $((count - 1)) > "$file"
}
signal_release() { [[ -e "$S/$1" ]] || return 0; rm -f "$S/$1"; kill -TERM "$(< "$S/release.pid")"; }
caddy_hash() { if [[ -e "$S/expected-caddy-hash" ]]; then cat "$S/expected-caddy-hash"; else printf 'hash-current\n'; fi; }
if [[ "${1:-}" == compose && "${2:-}" == version ]]; then exit 0; fi
if [[ "${1:-}" == compose ]]; then
  shift
  while [[ $# -gt 0 && "$1" != -f ]]; do shift; done
  shift 2
  sub="$1"; shift
  case "$sub" in
    config) if [[ "$*" == *--hash* ]]; then printf 'caddy %s\n' "$(caddy_hash)"; fi; exit 0 ;;
    up)
      [[ ! -e "$S/fail-up" ]] || exit 1
      service="${*: -1}"
      case "$service" in
        app-blue) printf '%s\n' "$APP_BLUE_IMAGE" > "$S/running-app-blue" ;;
        app-green) printf '%s\n' "$APP_GREEN_IMAGE" > "$S/running-app-green" ;;
        caddy) cp "$ROUTES_DIR/active-slot.caddy" "$S/caddy-loaded"; touch "$S/running-caddy"; caddy_hash > "$S/caddy-hash" ;;
        postgres) touch "$S/running-postgres" ;;
      esac
      exit 0 ;;
    ps)
      service="${*: -1}"
      if [[ "$*" == *--format* ]]; then
        ! consume fail-ps-state || exit 1
        [[ -e "$S/running-$service" ]] || exit 0
        if consume "restarting-$service"; then printf 'restarting\n'; else printf 'running\n'; fi
      elif [[ -e "$S/running-$service" ]]; then
        printf 'container-%s\n' "$service"
      fi
      exit 0 ;;
    stop)
      [[ ! -e "$S/fail-stop-${*: -1}" ]] || exit 1
      rm -f "$S/running-${*: -1}"; printf '%s\n' "${*: -1}" >> "$S/stopped"; exit 0 ;;
    exec)
      [[ "$1" != -T ]] || shift
      service="$1"; shift
      [[ -e "$S/running-$service" ]] || exit 1
      if [[ "$service" == caddy ]]; then
        [[ ! -e "$S/fail-reload-all" ]] || exit 1
        if [[ -e "$S/fail-reload-once" ]]; then rm -f "$S/fail-reload-once"; exit 1; fi
        if [[ -e "$S/break-tls-on-reload" ]]; then rm -f "$S/break-tls-on-reload"; touch "$S/fail-tls-all"; fi
        if [[ -e "$S/term-on-curl-after-reload" ]]; then rm -f "$S/term-on-curl-after-reload"; touch "$S/term-on-curl"; fi
        if [[ -e "$S/wrong-commit-on-reload" ]]; then
          touch "$S/wrong-commit-app-$(< "$S/wrong-commit-on-reload")"; rm -f "$S/wrong-commit-on-reload"
        fi
        cp "$ROUTES_DIR/active-slot.caddy" "$S/caddy-loaded"; exit 0
      fi
      # migrate --plan is read-only: recorded in $S/plans, answered from
      # $S/plan-output (stdout) and $S/plan-stderr, failed (with a
      # secret-bearing error on stderr) by $S/fail-plan.
      if [[ "$*" == 'python manage.py migrate --plan --no-color' ]]; then
        printf '%s %s\n' "$service" "$*" >> "$S/plans"
        if [[ -e "$S/fail-plan" ]]; then
          printf 'FATAL: password authentication failed for postgresql://mawareeth:LongUrlSafePassword_123456@postgres\n' >&2
          exit 1
        fi
        [[ ! -e "$S/plan-stderr" ]] || cat "$S/plan-stderr" >&2
        [[ ! -e "$S/plan-output" ]] || cat "$S/plan-output"
        exit 0
      fi
      if [[ "$1 $2" == 'python manage.py' ]]; then
        printf '%s %s\n' "$service" "$*" >> "$S/migrations"
        if [[ -e "$S/prior-unready-after-migrate" ]]; then touch "$S/fail-ready-$(< "$S/prior-unready-after-migrate")"; rm -f "$S/prior-unready-after-migrate"; fi
        signal_release term-on-migrate
        if [[ -e "$S/kill-on-migrate" ]]; then rm -f "$S/kill-on-migrate"; kill -KILL "$(< "$S/release.pid")"; exit 1; fi
        if [[ -e "$S/fail-migrate" ]]; then
          printf 'FATAL: password authentication failed for postgresql://mawareeth:LongUrlSafePassword_123456@postgres\n'
          exit 1
        fi
        exit 0
      fi
      case "${@: -2:1}" in
        /health/live/) [[ ! -e "$S/fail-live-$service" ]] ;;
        /health/ready/)
          [[ ! -e "$S/fail-ready-$service" ]] || exit 1
          ! consume "flaky-ready-$service" || exit 1
          printf '{"status":"ok"}' ;;
        /health/release/)
          commit="$(commit_of "$(< "$S/running-$service")")"
          [[ ! -e "$S/wrong-commit-$service" ]] || commit=0000000000000000000000000000000000000000
          printf '{"status":"ok","commit":"%s"}' "$commit" ;;
        *) exit 1 ;;
      esac
      exit $? ;;
    *) exit 1 ;;
  esac
fi
case "${1:-} ${2:-}" in
  'image inspect')
    if [[ "$*" == *RepoDigests* ]]; then
      printf '%s\n' \
        'ghcr.io/example/mawareeth@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
        'ghcr.io/example/mawareeth@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' \
        'docker.io/library/caddy@sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52' \
        'docker.io/library/postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3'
    else image_id "${*: -1}"; fi ;;
  'inspect --format')
    container="${*: -1}"; service="${container#container-}"
    [[ -e "$S/running-$service" ]] || exit 1
    case "$3" in
      *config-hash*) cat "$S/caddy-hash" ;;
      *.Image*) if [[ -e "$S/wrong-image-$service" ]]; then image_id other; else image_id "$(< "$S/running-$service")"; fi ;;
      *) exit 1 ;;
    esac ;;
  'volume ls') name="${*: -1}"; name="${name#name=^}"; name="${name%$}"; [[ ! -e "$S/volume-$name" ]] || printf '%s\n' "$name" ;;
  'volume inspect')
    name="${*: -1}"; [[ -e "$S/volume-$name" ]] || exit 1
    if [[ "$*" == *Mountpoint* ]]; then printf '/safe/%s\n' "$name"
    else case "$name" in *postgres*) printf 'mawareeth postgres\n' ;; *caddy-data*) printf 'mawareeth caddy-data\n' ;; *) printf 'mawareeth caddy-config\n' ;; esac; fi ;;
  'volume create') touch "$S/volume-${*: -1}"; printf '%s\n' "${*: -1}" ;;
  'run --rm') ;;
  *) exit 1 ;;
esac
EOF
# curl stub: answers as the edge would, from the route Caddy has loaded and the
# image running in the routed slot, with the route's slot header.
cat > "$stub/curl" <<'EOF'
#!/usr/bin/env bash
S='__S__'
printf 'curl %s\n' "$*" >> "$S/calls.log"
if [[ -e "$S/term-on-curl" ]]; then rm -f "$S/term-on-curl"; kill -TERM "$(< "$S/release.pid")"; fi
# A crash (SIGKILL, so no trap runs) on the first edge request.
if [[ -e "$S/kill-on-curl" ]]; then rm -f "$S/kill-on-curl"; kill -KILL "$(< "$S/release.pid")"; exit 7; fi
args=" $* "
url="${*: -1}"
# The edge name ($S/edge-host, default example.com) and, in cloudflare mode,
# the redirect name ($S/redirect-host).
host='example.com'; [[ ! -e "$S/edge-host" ]] || host="$(< "$S/edge-host")"
redirect=''; [[ ! -e "$S/redirect-host" ]] || redirect="$(< "$S/redirect-host")"
[[ "$args" == *" --proto =https "* ]] || exit 2
[[ "$args" != *' -k '* && "$args" != *' --insecure '* ]] || exit 2
# EDGE_MODE=cloudflare ($S/origin-ca names the bundle's roots): Caddy serves an
# Origin CA certificate, which verifies only against those pinned roots.
# Otherwise (acme) the public trust store applies and no --cacert is given.
if [[ -e "$S/origin-ca" ]]; then
  ca=''
  [[ ! "$args" =~ \ --cacert\ ([^ ]+)\  ]] || ca="${BASH_REMATCH[1]}"
  [[ -n "$ca" && "$ca" == "$(< "$S/origin-ca")" ]] || exit 60
  grep -q 'BEGIN CERTIFICATE' "$ca" || exit 77
else
  [[ "$args" != *' --cacert '* ]] || exit 2
fi
[[ ! -e "$S/fail-tls-all" ]] || exit 60
[[ -e "$S/running-caddy" && -e "$S/caddy-loaded" ]] || exit 7
# The redirect site answers 301 to the canonical name, as --write-out reports
# it ($S/fail-redirect makes it answer 200 instead).
if [[ -n "$redirect" && "$args" == *" --resolve $redirect:443:127.0.0.1 "* ]]; then
  [[ "$url" == "https://$redirect/" ]] || exit 2
  if [[ -e "$S/fail-redirect" ]]; then printf '200 '; else printf '301 https://%s/' "$host"; fi
  exit 0
fi
[[ "$args" == *" --resolve $host:443:127.0.0.1 "* ]] || exit 2
loaded="$(< "$S/caddy-loaded")"
[[ "$loaded" =~ reverse_proxy\ app-([a-z]+):8000 ]] || exit 52
slot="${BASH_REMATCH[1]}"
header=''
[[ ! "$loaded" =~ header_down\ X-Mawareeth-Slot\ ([a-z]+) ]] || header="${BASH_REMATCH[1]}"
[[ ! -e "$S/stale-header" ]] || header="$(< "$S/stale-header")"
[[ ! -e "$S/no-header-$slot" ]] || header=''
[[ ! -e "$S/fail-tls-$slot" ]] || exit 60
# Caddy answers release identity with 404 itself, for every client.
[[ "$url" != "https://$host/health/release"* ]] || exit 22
[[ -e "$S/running-app-$slot" ]] || exit 22
printf 'HTTP/2 200\r\ncontent-type: application/json\r\n'
[[ -z "$header" ]] || printf 'x-mawareeth-slot: %s\r\n' "$header"
printf '\r\n'
case "$url" in
  "https://$host/health/ready/") [[ ! -e "$S/fail-ready-app-$slot" ]] || exit 22; printf '{"status":"ok"}' ;;
  *) exit 22 ;;
esac
EOF
# Journal publication failure is injected at the rename of a chosen phase.
cat > "$stub/mv" <<'EOF'
#!/usr/bin/env bash
if [[ -e '__S__/fail-journal-phase' && "${*: -1}" == *deploy.journal ]] \
  && grep -qx "phase=$(< '__S__/fail-journal-phase')" "${*: -2:1}"; then exit 1; fi
if [[ -e '__S__/fail-record-mv-once' && "${*: -1}" == */slots/blue.env ]]; then rm -f '__S__/fail-record-mv-once'; exit 1; fi
# The rollback's journal write that resets records=replaced to untouched can be
# made to fail, or to crash (SIGKILL) right after it is published.
if [[ "${*: -1}" == *deploy.journal ]] && grep -qx 'records=untouched' "${*: -2:1}" \
  && grep -Eqx 'phase=(switching|verifying)' "${*: -2:1}" && grep -qx 'records=replaced' "${*: -1}" 2>/dev/null; then
  if [[ -e '__S__/fail-records-reset' ]]; then rm -f '__S__/fail-records-reset'; exit 1; fi
  if [[ -e '__S__/kill-after-records-reset' ]]; then
    rm -f '__S__/kill-after-records-reset'; '__MV__' "$@" || exit 1; kill -KILL "$(< '__S__/release.pid')"; exit 0
  fi
fi
# A crash (SIGKILL) right after a chosen state file is published.
if [[ -e '__S__/kill-after-mv' && "${*: -1}" == */"$(< '__S__/kill-after-mv')" ]]; then
  rm -f '__S__/kill-after-mv'; '__MV__' "$@" || exit 1; kill -KILL "$(< '__S__/release.pid')"; exit 0
fi
exec '__MV__' "$@"
EOF
sed -i "s|__S__|$S|g; s|__MV__|$real_mv|g" "$stub/docker" "$stub/curl" "$stub/mv"
grep -Fq "$S" "$stub/docker" || fail 'stub placeholders were not substituted'
! grep -Fq '__S__' "$stub/docker" "$stub/curl" "$stub/mv" || fail 'stub placeholders were not substituted'
chmod +x "$stub/docker" "$stub/curl" "$stub/mv"

if [[ -z "$real_flock" ]]; then
  printf '#!/usr/bin/env bash\n[[ ! -e %q ]]\n' "$S/lock-held" > "$stub/flock"
  chmod +x "$stub/flock"
fi
# Some platforms cannot fsync a read-only handle; keep the call, drop the effect.
printf 'probe\n' > "$tmp/sync-probe"
if ! "$real_sync" -- "$tmp/sync-probe" 2>/dev/null; then
  printf '#!/usr/bin/env bash\nexit 0\n' > "$stub/sync"; chmod +x "$stub/sync"
fi

# Unprivileged runs cannot create root-owned files (and some filesystems ignore
# chmod), so report the ownership and modes the runtime would establish.
# "$S/mode-<basename>" overrides the reported metadata for one file.
privileged=1
if [[ ${EUID:-999} -ne 0 ]]; then
  privileged=0
  cat > "$stub/stat" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == -c && "$2" == '%u:%g:%a' ]]; then
  if [[ -e "__S__/mode-${3##*/}" ]]; then cat "__S__/mode-${3##*/}"; exit 0; fi
  case "$3" in
    *runtime-images.lock|*/routes|*/routes/*.caddy) printf '0:0:%s\n' "$([[ -d "$3" ]] && echo 755 || echo 644)" ;;
    *) if [[ -d "$3" ]]; then printf '0:0:700\n'; else printf '0:0:600\n'; fi ;;
  esac
else
  exec '__STAT__' "$@"
fi
EOF
  printf '#!/usr/bin/env bash\nexit 0\n' > "$stub/chown"
  cat > "$stub/install" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == -d ]]; then mkdir -p "${*: -1}"; else exec '__INSTALL__' "$@"; fi
EOF
  sed -i "s|__S__|$S|g; s|__STAT__|$real_stat|g; s|__INSTALL__|$real_install|g" "$stub/stat" "$stub/install"
  ! grep -Fq '__' "$stub/stat" "$stub/install" || fail 'stub placeholders were not substituted'
  chmod +x "$stub/stat" "$stub/chown" "$stub/install"
fi

base_env=(PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$tmp/runtime.env" MAWAREETH_RUNTIME_DIR="$state" MAWAREETH_RUNTIME_WAIT_TIMEOUT=5
  MAWAREETH_DEPLOY_LIVE_TIMEOUT=2 MAWAREETH_DEPLOY_READY_TIMEOUT=2 MAWAREETH_DEPLOY_VERIFY_TIMEOUT=2 MAWAREETH_DEPLOY_POLL_INTERVAL=1)
rc=0
# Each slot's .prev as it was before the latest run.
save_prev() {
  local slot
  for slot in blue green; do
    if [[ -e "$state/slots/$slot.env.prev" ]]; then cp "$state/slots/$slot.env.prev" "$tmp/prev-before-$slot"
    else rm -f "$tmp/prev-before-$slot"; fi
  done
}
prev_unchanged() {
  if [[ -e "$tmp/prev-before-$1" ]]; then cmp -s "$state/slots/$1.env.prev" "$tmp/prev-before-$1"
  else [[ ! -e "$state/slots/$1.env.prev" ]]; fi
}
# run SCRIPT ARG MANIFEST [ENV...] checks out the manifest's bundle commit first
# and records the script's PID so stubs can signal it.
# ARG may hold several words (for example "recover --dry-run").
run() {
  local script="$1" arg="$2" manifest="$3" pid; shift 3
  local -a words
  read -ra words <<<"$arg"
  case "$manifest" in manifest-a|manifest-b-at-a) use_bundle "$commit_a" ;; *) use_bundle "$commit_b" ;; esac
  [[ ! -d "$state/slots" ]] || save_prev
  set +e
  env "${base_env[@]}" MAWAREETH_RELEASE_MANIFEST="$tmp/$manifest.json" "$@" bash "$script" "${words[@]}" > "$tmp/out" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" > "$S/release.pid"
  { wait "$pid"; } 2>/dev/null
  rc=$?
  set -e
}
run_release() { local manifest="$1"; shift; run "$release" deploy "$manifest" "$@"; }
run_runtime() { local arg="$1" manifest="$2"; shift 2; run "$runtime" "$arg" "$manifest" "$@"; }
# recover never reads a manifest: the path given to it does not exist.
run_recover() { local arg="recover${1:+ $1}"; shift || true; run "$release" "$arg" no-such-manifest "$@"; }
# After a SIGKILL a stub child may hold the lock descriptor for a moment.
settle() {
  local tries
  if [[ -n "$real_flock" ]]; then
    "$real_flock" -w 10 "$state/deploy.lock" true || fail 'lock still held after SIGKILL'
    return 0
  fi
  # Without flock(1), wait (bounded) until the killed script and the stub that
  # killed it are gone.
  for ((tries = 0; tries < 50; tries++)); do
    if ! kill -0 "$(< "$S/release.pid")" 2>/dev/null && ! pgrep -f "$stub/" >/dev/null 2>&1; then return 0; fi
    sleep 0.2
  done
  fail 'the killed deploy or its stub is still running after SIGKILL'
}
expect_rc() { [[ "$rc" == "$1" ]] || fail "$2: expected exit $1, got $rc"; }
mutations() { grep -cE '^docker compose .* (up|stop|down)( |$)|manage\.py migrate --noinput|caddy reload' "$S/calls.log" 2>/dev/null || true; }
route_is() { [[ "$(< "$state/routes/active-slot.caddy")" == *"reverse_proxy app-$1:8000"*"header_down X-Mawareeth-Slot $1"* ]] || fail "route does not target $1"; }
caddy_is() { [[ -e "$S/running-caddy" && "$(< "$S/caddy-loaded")" == *"reverse_proxy app-$1:8000"* ]] || fail "Caddy does not serve $1"; }
running() { [[ -e "$S/running-app-$1" ]]; }
no_secrets() { ! grep -Eq 'LongUrlSafePassword_123456|a-long-django-key|mailgun-secret-value' "$tmp/out" || fail "$1 leaked a secret"; }
no_temporaries() { [[ -z "$(find "$state" -name '.tmp.*' -print -quit)" ]] || fail "$1 left a temporary file behind"; }
journal_field() { grep -E "^$1=" "$state/deploy.journal" | head -n 1 | cut -d= -f2-; }
journal_failed_idle() {
  [[ "$(journal_field phase)" == idle && "$(journal_field result)" == failed:* ]] || fail "$1 did not journal the failure"
}
snapshot_count() { find "$state" -maxdepth 1 -name '*.snapshot.env' | wc -l | tr -d ' '; }
migrations() { if [[ -e "$S/migrations" ]]; then wc -l < "$S/migrations" | tr -d ' '; else printf '0\n'; fi; }
plans() { if [[ -e "$S/plans" ]]; then wc -l < "$S/plans" | tr -d ' '; else printf '0\n'; fi; }
line_of() { grep -nE "$1" "$S/calls.log" | tail -n 1 | cut -d: -f1; }
write_journal() {
  (umask 077; printf 'phase=%s\nprior_slot=green\ncandidate_slot=blue\nmanifest_commit=%s\nprior_commit=%s\nresult=in-progress\nstarted_at=2026-01-01T00:00:00Z\nupdated_at=2026-01-01T00:00:00Z\ndeploy_log=/var/log/deploy.log\nmigrate_log=/var/log/migrate.log\n' "$1" "$commit_a" "$commit_b" > "$state/deploy.journal")
}
plant_prev() { (umask 077; printf 'IMAGE=%s\nCOMMIT=%s\nSNAPSHOT=%s\n' "$image_b" "$commit_b" "$(printf '%064d' 7).snapshot.env" > "$state/slots/$1.env.prev"); }
# write_journal11 PHASE PRIOR CANDIDATE MANIFEST_COMMIT PRIOR_COMMIT RESULT RECORDS
write_journal11() {
  (umask 077; printf 'phase=%s\nprior_slot=%s\ncandidate_slot=%s\nmanifest_commit=%s\nprior_commit=%s\nresult=%s\nstarted_at=2026-01-01T00:00:00Z\nupdated_at=2026-01-01T00:00:00Z\ndeploy_log=/var/log/deploy.log\nmigrate_log=/var/log/migrate.log\nrecords=%s\n' "$@" > "$state/deploy.journal")
}
# A recover that fails after it began must leave the journal byte for byte.
journal_kept() { cmp -s "$state/deploy.journal" "$tmp/journal.crashed" || fail "$1 changed the journal"; }
# An abandoned blue candidate was rolled back to green.
assert_recovered_to_green() {
  expect_rc 0 "$1"
  route_is green; caddy_is green
  running green || fail "$1 stopped the prior slot"
  ! running blue || fail "$1 left the abandoned candidate running"
  cmp -s "$state/slots/blue.env" "$2" || fail "$1 did not restore the blue slot record"
  # After restoring from .prev, .prev equals the restored record (the older
  # .prev was overwritten by the deploy's switching step, as documented).
  if [[ "${3:-}" == prev ]]; then cmp -s "$state/slots/blue.env.prev" "$2" || fail "$1: .prev differs from the restored record"; fi
  journal_failed_idle "$1"
  [[ "$(journal_field records)" == untouched ]] || fail "$1 did not journal records=untouched"
  no_temporaries "$1"; no_secrets "$1"
}
recover_again_is_noop() {
  local calls
  calls="$(mutations)"; cp "$state/deploy.journal" "$tmp/journal.recovered"
  run_recover
  expect_rc 0 "$1 (second recover)"
  need "$tmp/out" 'nothing to recover'
  [[ "$(mutations)" == "$calls" ]] || fail "$1: a second recover mutated Docker state"
  cmp -s "$state/deploy.journal" "$tmp/journal.recovered" || fail "$1: a second recover touched the journal"
}

# --- Preparation and bootstrap -------------------------------------------------
run_recover
expect_rc 0 'recover before any state exists'
need "$tmp/out" 'nothing to recover'
[[ ! -e "$state" ]] || fail 'recover created runtime state'
run_runtime prepare manifest-a
expect_rc 0 'runtime prepare'
route_is blue
[[ ! -e "$state/slots/blue.env" && ! -e "$state/slots/green.env" ]] || fail 'prepare recorded a release'
[[ "$(snapshot_count)" == 1 ]] || fail 'prepare did not create one snapshot'

run_runtime up manifest-a
[[ "$rc" != 0 ]] || fail 'runtime up started without an active release record'
need "$tmp/out" 'bootstrap the first release with deploy/release.sh deploy'
[[ "$(mutations)" == 0 ]] || fail 'refused runtime up mutated Docker state'

# A live pre-0.6 runtime (slots or Caddy running without records) is refused.
for service in app-blue caddy; do
  touch "$S/running-$service"; run_release manifest-a; rm -f "$S/running-$service"
  expect_rc 2 "bootstrap over a live legacy $service"
  need "$tmp/out" 'migrate it manually'
  [[ "$(mutations)" == 0 ]] || fail 'legacy-runtime refusal mutated Docker state'
done

# Bootstrap whose candidate never becomes ready: nothing is routed, and a
# stale .prev of the never-recorded slot survives the failure.
plant_prev blue
touch "$S/fail-ready-app-blue"; run_release manifest-a; rm -f "$S/fail-ready-app-blue"
expect_rc 5 'bootstrap with unready candidate'
[[ ! -e "$S/running-caddy" ]] || fail 'bootstrap failure started Caddy'
! running blue || fail 'bootstrap failure left the candidate running'
[[ ! -e "$state/slots/blue.env" ]] || fail 'bootstrap failure recorded an unverified release'
prev_unchanged blue || fail 'bootstrap failure changed an existing .prev'
journal_failed_idle 'bootstrap with unready candidate'
[[ "$(journal_field records)" == untouched ]] || fail 'a failure before switching journaled replaced records'
[[ "$(journal_field prior_slot)" == '' && "$(journal_field candidate_slot)" == blue ]] || fail 'bootstrap journal identity is wrong'
[[ "$(journal_field deploy_log)" == "$state"/logs/deploy-*.log && -f "$(journal_field deploy_log)" ]] || fail 'journal does not name the deploy log'
[[ "$(journal_field migrate_log)" == "$state"/logs/migrate-*.log && -n "$(journal_field started_at)" ]] || fail 'journal does not name the migrate log and start time'

# Bootstrap whose edge verification fails: Caddy is stopped and the record removed.
touch "$S/fail-tls-blue"; run_release manifest-a; rm -f "$S/fail-tls-blue"
expect_rc 6 'bootstrap with failed TLS verification'
[[ ! -e "$S/running-caddy" ]] || fail 'bootstrap rollback left Caddy serving an unverified slot'
! running blue || fail 'bootstrap rollback left the candidate running'
[[ ! -e "$state/slots/blue.env" ]] || fail 'first-deploy record was not removed'
prev_unchanged blue || fail 'bootstrap rollback did not restore the existing .prev'
journal_failed_idle 'bootstrap with failed TLS verification'
no_temporaries 'bootstrap rollback'; no_secrets 'bootstrap rollback'

# --- recover: a bootstrap that crashed while verifying ------------------------
touch "$S/kill-on-curl"; run_release manifest-a; rm -f "$S/kill-on-curl"; settle
expect_rc 137 'bootstrap killed during verification'
[[ "$(journal_field phase)" == verifying && "$(journal_field records)" == replaced ]] || fail 'the crashed bootstrap journal is wrong'
[[ -e "$S/running-caddy" ]] && running blue && [[ -e "$state/slots/blue.env" ]] || fail 'the crashed bootstrap did not leave Caddy, blue and its record'
cp "$state/deploy.journal" "$tmp/journal.crashed"
before="$(mutations)"
run_recover --dry-run
expect_rc 0 'recover dry run after a crashed bootstrap'
need "$tmp/out" 'serve:   nothing (unverified bootstrap)'
need "$tmp/out" 'records: remove blue.env'
need "$tmp/out" 'stop:    Caddy (confirmed stopped), then app-blue'
need "$tmp/out" 'dry run: nothing changed'
[[ "$(mutations)" == "$before" ]] || fail 'recover --dry-run mutated Docker state'
journal_kept 'recover --dry-run'
[[ -e "$state/slots/blue.env" && -e "$S/running-caddy" ]] || fail 'recover --dry-run changed state'
touch "$S/fail-stop-caddy"; run_recover; rm -f "$S/fail-stop-caddy"
expect_rc 7 'recover when Caddy cannot be stopped'
need "$tmp/out" 'CRITICAL'
journal_kept 'a failed bootstrap recover'
run_recover
expect_rc 0 'recover of a crashed bootstrap'
[[ ! -e "$S/running-caddy" ]] || fail 'bootstrap recover left Caddy running'
! running blue || fail 'bootstrap recover left the unverified candidate running'
[[ ! -e "$state/slots/blue.env" && ! -e "$state/slots/green.env" ]] || fail 'bootstrap recover kept an unverified record'
journal_failed_idle 'bootstrap recover'
[[ "$(journal_field result)" == failed:verifying && "$(journal_field records)" == untouched ]] || fail 'bootstrap recover journaled the wrong result'
no_temporaries 'bootstrap recover'; no_secrets 'bootstrap recover'
recover_again_is_noop 'bootstrap recover'

# A deploy after a bootstrap recover succeeds.
: > "$S/calls.log"; before_migrations="$(migrations)"
run_release manifest-a
expect_rc 0 'bootstrap'
route_is blue; caddy_is blue
[[ -e "$S/running-postgres" ]] || fail 'bootstrap did not start PostgreSQL'
[[ "$(< "$S/running-app-blue")" == "$image_a" ]] || fail 'bootstrap does not run the manifest image'
[[ "$(migrations)" == $((before_migrations + 1)) ]] || fail 'bootstrap did not migrate exactly once'
need "$state/slots/blue.env" "IMAGE=$image_a"
need "$state/slots/blue.env" "COMMIT=$commit_a"
[[ ! -e "$state/slots/blue.env.prev" ]] || fail 'bootstrap kept a stale .prev for a slot with no previous record'
[[ ! -e "$state/slots/green.env" ]] || fail 'bootstrap recorded the idle slot'
[[ "$(journal_field phase)" == idle && "$(journal_field result)" == success && "$(journal_field prior_slot)" == '' ]] || fail 'bootstrap journal is wrong'
[[ "$(line_of 'up .*postgres$')" -lt "$(line_of 'up .*app-blue$')" && "$(line_of 'up .*app-blue$')" -lt "$(line_of 'up .*caddy$')" ]] \
  || fail 'bootstrap did not start PostgreSQL, the candidate, then Caddy'
[[ "$(line_of 'manage.py migrate')" -lt "$(line_of 'up .*caddy$')" ]] || fail 'bootstrap routed before migrating'

# recover of a verified bootstrap (it stopped before resetting the journal):
# the candidate keeps serving and the journal becomes idle success.
write_journal11 verifying '' blue "$commit_a" '' verified replaced
run_recover
expect_rc 0 'recover of a verified bootstrap'
route_is blue; caddy_is blue
running blue && [[ "$(< "$S/running-app-blue")" == "$image_a" ]] || fail 'verified bootstrap recover changed the serving release'
need "$state/slots/blue.env" "COMMIT=$commit_a"
[[ ! -e "$state/slots/green.env" ]] || fail 'verified bootstrap recover recorded the idle slot'
[[ "$(journal_field phase)" == idle && "$(journal_field result)" == success && "$(journal_field records)" == untouched ]] \
  || fail 'verified bootstrap recover did not reset the journal to idle success'

# --- Happy deploy: release B into idle green ---------------------------------
plant_prev green
: > "$S/calls.log"; before_migrations="$(migrations)"; before_plans="$(plans)"
# An additive plan (add, create, alter) passes the contract gate.
printf '%s\n' 'Planned operations:' 'calc.0042_expand' '    Create model Heir' '    Add field share to heir' '    Alter field name on heir' \
  'calc.0043_backfill' '    Raw Python operation' > "$S/plan-output"
run_release manifest-b
rm -f "$S/plan-output"
expect_rc 0 'happy deploy'
[[ "$(plans)" == $((before_plans + 1)) && "$(tail -n 1 "$S/plans")" == 'app-green python manage.py migrate --plan --no-color' ]] \
  || fail 'the migration plan was not inspected once in the candidate'
plan_line="$(line_of 'exec -T app-green python manage.py migrate --plan --no-color$')"
[[ -n "$plan_line" && "$plan_line" -lt "$(line_of 'exec -T app-green python manage.py migrate --noinput$')" ]] || fail 'the plan did not run before the migration'
grep -Fq '    Add field share to heir' "$(journal_field migrate_log)" || fail 'the plan was not kept in the migrate log'
! grep -Fq 'Add field' "$tmp/out" || fail 'the plan was shown on the terminal'
route_is green; caddy_is green
[[ "$(< "$S/running-app-green")" == "$image_b" ]] || fail 'green does not run the manifest image'
! running blue || fail 'old slot was not drained'
[[ "$(migrations)" == $((before_migrations + 1)) ]] || fail 'migrations did not run exactly once'
[[ "$(tail -n 1 "$S/migrations")" == 'app-green python manage.py migrate --noinput' ]] || fail 'migration did not run in the candidate'
first_curl="$(grep -nE '^curl ' "$S/calls.log" | head -n 1 | cut -d: -f1)"
last_curl="$(line_of '^curl ')"; blue_stop="$(line_of '^docker compose .* stop -t 35 app-blue$')"
[[ -n "$last_curl" && -n "$blue_stop" && "$blue_stop" -gt "$last_curl" ]] || fail 'old slot stopped before TLS verification'
up_green="$(line_of '^docker compose .* up .*--force-recreate app-green$')"
migrate_line="$(line_of 'exec -T app-green python manage.py migrate')"
reload_line="$(line_of 'exec -T caddy caddy reload')"
[[ "$first_curl" -lt "$up_green" ]] || fail 'the edge was not confirmed before mutation'
[[ "$up_green" -lt "$migrate_line" && "$migrate_line" -lt "$reload_line" && "$reload_line" -lt "$last_curl" ]] || fail 'deploy phases ran out of order'
grep -E '^curl .*--resolve example.com:443:127.0.0.1 .*https://example.com/health/ready/$' "$S/calls.log" >/dev/null || fail 'edge was not verified through the production name'
! grep -E '^curl .*https://example.com/health/release' "$S/calls.log" >/dev/null || fail 'the edge was asked for release identity, which Caddy hides'
[[ "$(line_of '^docker compose .* exec -T app-green python -c .* /health/release/ ')" -gt "$reload_line" ]] || fail 'the routed slot commit was not probed directly after the switch'
grep -E '^docker inspect --format \{\{\.Image\}\} container-app-green$' "$S/calls.log" >/dev/null || fail 'candidate image was not verified'
need "$state/slots/green.env" "IMAGE=$image_b"
need "$state/slots/green.env" "COMMIT=$commit_b"
need "$state/slots/blue.env" "IMAGE=$image_a"
[[ ! -e "$state/slots/green.env.prev" ]] || fail 'a stale .prev survived a first deploy to green'
[[ "$(journal_field phase)" == idle && "$(journal_field result)" == success ]] || fail 'journal is not idle after success'
[[ "$(journal_field records)" == replaced && "$(wc -l < "$state/deploy.journal" | tr -d ' ')" == 11 ]] || fail 'the journal lacks the records= line'
[[ "$(journal_field prior_slot)" == blue && "$(journal_field candidate_slot)" == green ]] || fail 'journal lacks slot identity'
[[ "$(journal_field manifest_commit)" == "$commit_b" && "$(journal_field prior_commit)" == "$commit_a" ]] || fail 'journal lacks commit identity'
[[ "$(snapshot_count)" == 1 ]] || fail 'deploy changed runtime snapshots'
no_temporaries 'happy deploy'; no_secrets 'happy deploy'

# --- runtime.sh after a deploy: route preserved, drift refused ----------------
: > "$S/calls.log"
run_runtime prepare manifest-b
expect_rc 0 'prepare after deploy'
route_is green
run_runtime up manifest-b
expect_rc 0 'runtime up after deploy'
route_is green; caddy_is green
grep -E '^docker compose .* up .*--wait .*app-green$' "$S/calls.log" >/dev/null || fail 'runtime up did not restart the routed slot'
! grep -E '^docker compose .* up .*app-blue$' "$S/calls.log" >/dev/null || fail 'runtime up started the idle slot'
[[ "$(< "$S/running-app-green")" == "$image_b" ]] || fail 'runtime up changed the routed release'
before="$(mutations)"
run_runtime up manifest-a
[[ "$rc" != 0 ]] || fail 'runtime up accepted image drift'
need "$tmp/out" 'different image'
run_runtime up manifest-b-at-a
[[ "$rc" != 0 ]] || fail 'runtime up accepted commit drift'
need "$tmp/out" 'different commit'
sed 's/^DJANGO_KEY=.*/DJANGO_KEY=another-long-django-key-that-is-never-printed-12345/' "$tmp/runtime.env" > "$tmp/drift.env"; chmod 600 "$tmp/drift.env"
snapshots_before=("$state"/*.snapshot.env)
run_runtime prepare manifest-b MAWAREETH_RUNTIME_FILE="$tmp/drift.env"
expect_rc 0 'prepare with rotated configuration'
run_runtime up manifest-b MAWAREETH_RUNTIME_FILE="$tmp/drift.env"
[[ "$rc" != 0 ]] || fail 'runtime up accepted configuration drift'
need "$tmp/out" 'rotate configuration separately'
for snapshot in "$state"/*.snapshot.env; do [[ "$snapshot" == "${snapshots_before[0]}" ]] || rm -f -- "$snapshot"; done
[[ "$(mutations)" == "$before" ]] || fail 'refused runtime up mutated Docker state'
route_is green

# --- Refusals before any mutation ---------------------------------------------
cp "$state/deploy.journal" "$tmp/journal.before"; before="$(mutations)"
assert_untouched() {
  [[ "$(mutations)" == "$before" ]] || fail "$1 mutated Docker state"
  cmp -s "$state/deploy.journal" "$tmp/journal.before" || fail "$1 touched the journal"
  route_is green; caddy_is green; running green || fail "$1 stopped production"
  no_secrets "$1"
}

run_recover
expect_rc 0 'recover with an idle journal'
need "$tmp/out" 'nothing to recover'
assert_untouched 'recover with an idle journal'

if [[ -n "$real_flock" ]]; then
  exec 8>>"$state/deploy.lock"; "$real_flock" -n 8
  run_release manifest-a; rc_release="$rc"
  run_runtime up manifest-b; rc_runtime="$rc"
  run_recover; rc_recover="$rc"
  exec 8>&-
else
  touch "$S/lock-held"
  run_release manifest-a; rc_release="$rc"
  run_runtime up manifest-b; rc_runtime="$rc"
  run_recover; rc_recover="$rc"
  rm -f "$S/lock-held"
fi
rc="$rc_release"; expect_rc 3 'concurrent deploy'
rc="$rc_recover"; expect_rc 3 'recover while the lock is held'
[[ "$rc_runtime" != 0 ]] || fail 'runtime up ran while the deploy lock was held'
assert_untouched 'concurrent deploy'

write_journal switching
cp "$state/deploy.journal" "$tmp/journal.interrupted"
run_release manifest-a
expect_rc 4 'non-idle journal'
need "$tmp/out" "$state/deploy.journal is not idle"; need "$tmp/out" 'Run deploy/release.sh recover'
# A legacy ten-line journal is still accepted (and refused as not idle) by the
# deploy and runtime, but recover will not guess whether records were replaced.
for arg in '' --dry-run; do
  run_recover "$arg"
  expect_rc 2 "recover ${arg:-without options} of a legacy journal"
  need "$tmp/out" 'legacy ten-line format'; need "$tmp/out" 'manual recovery steps'
done
for command in up prepare down; do
  run_runtime "$command" manifest-b
  [[ "$rc" != 0 ]] || fail "runtime $command ran with a non-idle journal"
  need "$tmp/out" 'is not idle'
done
[[ "$(mutations)" == "$before" ]] || fail 'non-idle journal allowed mutation'
cmp -s "$state/deploy.journal" "$tmp/journal.interrupted" || fail 'refusal rewrote the interrupted journal'
(umask 077; printf 'phase=idle\ngarbage\n' > "$state/deploy.journal")
run_release manifest-a
expect_rc 4 'malformed journal'
need "$tmp/out" 'is unsafe or malformed'
run_recover
expect_rc 2 'recover of a malformed journal'
need "$tmp/out" 'is unsafe or malformed'
# Records that contradict the journal: green records commit B, not A.
write_journal11 switching green blue "$commit_a" "$commit_a" in-progress replaced
run_recover
expect_rc 2 'recover with records that contradict the journal'
need "$tmp/out" 'but the journal expects'
write_journal11 switching green green "$commit_a" "$commit_b" in-progress replaced
run_recover
expect_rc 2 'recover of a journal naming one slot twice'
# refuse_recover NAME MESSAGE [RECOVER-ARG [ENV...]]: exit 2 and nothing changes.
refuse_recover() {
  local name="$1" message="$2" calls; shift 2
  calls="$(mutations)"
  cp "$state/deploy.journal" "$tmp/journal.refused"
  cp "$state/slots/blue.env" "$tmp/blue.refused"; cp "$state/slots/green.env" "$tmp/green.refused"
  run_recover "$@"
  expect_rc 2 "$name"
  need "$tmp/out" "$message"
  [[ "$(mutations)" == "$calls" ]] || fail "$name mutated Docker state"
  cmp -s "$state/deploy.journal" "$tmp/journal.refused" || fail "$name touched the journal"
  cmp -s "$state/slots/blue.env" "$tmp/blue.refused" || fail "$name changed the blue slot record"
  cmp -s "$state/slots/green.env" "$tmp/green.refused" || fail "$name changed the green slot record"
  route_is green; caddy_is green; running green || fail "$name stopped production"
}
write_journal11 switching green blue "$commit_b" "$commit_b" in-progress replaced
refuse_recover 'candidate record matching neither the manifest commit nor .prev' 'matches neither the journal'
write_journal11 verifying green blue "$commit_a" "$commit_a" verified replaced
refuse_recover 'verified journal whose prior record differs' "does not match the journal's prior commit"
write_journal11 verifying green blue "$commit_a" "$commit_b" success replaced
refuse_recover 'non-idle journal with result=success' 'result=success'
write_journal11 switching '' blue "$commit_a" '' in-progress replaced
refuse_recover 'bootstrap journal while the other slot has a record' 'describes a bootstrap'
write_journal11 switching green blue "$commit_a" "$commit_b" in-progress untouched
green_snapshot="$state/$(sed -n 's/^SNAPSHOT=//p' "$state/slots/green.env")"
mv "$green_snapshot" "$tmp/snapshot.away"
refuse_recover 'missing target snapshot' 'is missing'
mv "$tmp/snapshot.away" "$green_snapshot"
cp -p "$green_snapshot" "$tmp/snapshot.copy"; printf 'EXTRA=1\n' >> "$green_snapshot"
refuse_recover 'drifted target snapshot' 'drifted'
cp -p "$tmp/snapshot.copy" "$green_snapshot"
refuse_recover 'runtime configuration drift' 'restore the runtime file matching the recorded snapshot' '' MAWAREETH_RUNTIME_FILE="$tmp/drift.env"
refuse_recover 'an unknown recover option' 'usage: release.sh' --bogus
refuse_recover 'an extra recover argument' 'usage: release.sh' '--dry-run extra'
cp "$tmp/journal.before" "$state/deploy.journal"
if ((privileged)); then chmod 644 "$state/deploy.journal"; else printf '0:0:644\n' > "$S/mode-deploy.journal"; fi
run_release manifest-a
rm -f "$S/mode-deploy.journal"; chmod 600 "$state/deploy.journal"
expect_rc 4 'unsafe journal mode'
need "$tmp/out" 'is unsafe or malformed'
assert_untouched 'journal refusals'

run_release manifest-a MAWAREETH_RUNTIME_FILE="$tmp/drift.env"
expect_rc 2 'config drift'
need "$tmp/out" 'rotate configuration separately'
[[ "$(snapshot_count)" == 1 ]] || fail 'config drift wrote a snapshot'
! grep -Fq 'another-long-django-key' "$tmp/out" || fail 'config drift leaked a secret'
assert_untouched 'config drift'

use_bundle "$commit_a"; printf 'local edit\n' > "$bundle/deploy/untracked.txt"
run_release manifest-a
rm -f "$bundle/deploy/untracked.txt"
expect_rc 2 'dirty deployment bundle'
need "$tmp/out" 'uncommitted changes'
assert_untouched 'dirty deployment bundle'

touch "$S/fail-ready-app-green"; run_release manifest-a; rm -f "$S/fail-ready-app-green"
expect_rc 2 'unhealthy active slot'
need "$tmp/out" 'is not ready'
assert_untouched 'unhealthy active slot'

touch "$S/wrong-image-app-green"; run_release manifest-a; rm -f "$S/wrong-image-app-green"
expect_rc 2 'active slot running an unrecorded image'
need "$tmp/out" 'not running its recorded image'
assert_untouched 'active slot running an unrecorded image'

touch "$S/fail-tls-green"; run_release manifest-a; rm -f "$S/fail-tls-green"
expect_rc 2 'edge pre-check failure'
need "$tmp/out" 'does not confirm active app-green'
assert_untouched 'edge pre-check failure'

# The edge serves green, but green reports another commit (read directly).
touch "$S/wrong-commit-app-green"; run_release manifest-a; rm -f "$S/wrong-commit-app-green"
expect_rc 2 'edge pre-check with a wrong slot commit'
need "$tmp/out" 'does not confirm active app-green'
assert_untouched 'edge pre-check with a wrong slot commit'

printf 'hash-of-a-newer-model\n' > "$S/expected-caddy-hash"; run_release manifest-a; rm -f "$S/expected-caddy-hash"
expect_rc 2 'stale Caddy container'
need "$tmp/out" 'run deploy/runtime.sh up first'
assert_untouched 'stale Caddy container'

printf 'candidate-starting\n' > "$S/fail-journal-phase"; run_release manifest-a; rm -f "$S/fail-journal-phase"
expect_rc 2 'journal write failure'
assert_untouched 'journal write failure'; no_temporaries 'journal write failure'

# --- Candidate failures (release A into blue): route never moves ---------------
cp "$state/slots/blue.env" "$tmp/blue.before"
plant_prev blue
assert_candidate_failure() {
  expect_rc 5 "$1"
  route_is green; caddy_is green
  running green || fail "$1 stopped the healthy slot"
  ! running blue || fail "$1 left the candidate running"
  cmp -s "$state/slots/blue.env" "$tmp/blue.before" || fail "$1 changed the candidate slot record"
  prev_unchanged blue || fail "$1 changed the candidate's .prev"
  journal_failed_idle "$1"
  no_temporaries "$1"; no_secrets "$1"
}
touch "$S/fail-ready-app-blue"; run_release manifest-a; rm -f "$S/fail-ready-app-blue"
assert_candidate_failure 'unready candidate'
touch "$S/wrong-commit-app-blue"; run_release manifest-a; rm -f "$S/wrong-commit-app-blue"
assert_candidate_failure 'wrong release identity'
touch "$S/fail-live-app-blue"; run_release manifest-a; rm -f "$S/fail-live-app-blue"
assert_candidate_failure 'candidate never live'
touch "$S/wrong-image-app-blue"; run_release manifest-a; rm -f "$S/wrong-image-app-blue"
assert_candidate_failure 'candidate running the wrong image'
need "$tmp/out" 'is not running the manifest image'
printf 'migrating\n' > "$S/fail-journal-phase"; run_release manifest-a; rm -f "$S/fail-journal-phase"
assert_candidate_failure 'journal failure before migrating'
printf 'app-green\n' > "$S/prior-unready-after-migrate"; run_release manifest-a; rm -f "$S/fail-ready-app-green"
assert_candidate_failure 'active slot unready after migration'
need "$tmp/out" 'may not be backward compatible'
before_migrations="$(migrations)"
touch "$S/fail-migrate"; run_release manifest-a; rm -f "$S/fail-migrate"
assert_candidate_failure 'migration failure'
need "$tmp/out" 'migration failed'
[[ "$(migrations)" == $((before_migrations + 1)) ]] || fail 'failed migration was retried'
! grep -Ev 'python manage.py migrate --noinput$' "$S/migrations" | grep -q . || fail 'a non-forward migration command ran'
migrate_logs=("$state"/logs/migrate-*.log)
grep -lq 'password authentication failed' "${migrate_logs[@]}" || fail 'migration output was not kept in a diagnostic log'
touch "$S/term-on-migrate"; run_release manifest-a
assert_candidate_failure 'TERM during migration'
[[ "$(journal_field result)" == failed:migrating ]] || fail 'TERM during migration was not journaled as a migrating failure'

# Contract gate: a plan that removes or renames schema is refused before
# migrating unless --allow-contract is passed; the plan stays in the log.
for operation in 'Remove field share from heir' 'Delete model Heir' 'Rename field name on heir to full_name' \
  'Rename model Heir to Inheritor' 'Rename table for heir to calc_heir' 'Raw SQL operation -> DROP TABLE calc_heir' \
  'Custom state/database change combination'; do
  printf '%s\n' 'Planned operations:' 'calc.0044_contract' '    Add field note to heir' "    $operation" > "$S/plan-output"
  before_migrations="$(migrations)"; before_plans="$(plans)"
  run_release manifest-a
  assert_candidate_failure "contract plan ($operation)"
  [[ "$(journal_field result)" == failed:candidate-starting ]] || fail "contract plan ($operation) was not refused before migrating"
  [[ "$(migrations)" == "$before_migrations" ]] || fail "contract plan ($operation) ran migrate --noinput"
  [[ "$(plans)" == $((before_plans + 1)) ]] || fail "contract plan ($operation) was not inspected"
  need "$tmp/out" '--allow-contract'
  need "$tmp/out" "$(journal_field migrate_log)"
  ! grep -Fq -e "$operation" -e 'calc.0044' -e 'Planned operations' -e 'note to heir' "$tmp/out" || fail "contract plan ($operation) was shown on the terminal"
  need "$(journal_field migrate_log)" "    $operation"
done
# Contract phrases count only at the start of an indented plan operation, not
# inside other text, and plan stderr is never matched.
printf '%s\n' 'Planned operations:' 'calc.0045_remove_field_note' '    Raw Python operation -> Remove field x from y' > "$S/plan-output"
printf '%s\n' '    Remove field share from heir' > "$S/plan-stderr"
before_migrations="$(migrations)"
touch "$S/fail-ready-app-blue"; run_release manifest-a; rm -f "$S/fail-ready-app-blue"
assert_candidate_failure 'unready candidate after a non-contract plan'
[[ "$(migrations)" == $((before_migrations + 1)) ]] || fail 'a non-contract plan was refused'
[[ "$(journal_field result)" != failed:candidate-starting ]] || fail 'a non-contract plan was refused by the gate'
need "$(journal_field migrate_log)" '    Remove field share from heir'
rm -f "$S/plan-output" "$S/plan-stderr"

before_migrations="$(migrations)"
touch "$S/fail-plan"; run_release manifest-a; rm -f "$S/fail-plan"
assert_candidate_failure 'failed migration plan'
[[ "$(journal_field result)" == failed:candidate-starting ]] || fail 'a failed plan was not refused before migrating'
[[ "$(migrations)" == "$before_migrations" ]] || fail 'a failed plan still ran migrate --noinput'
need "$tmp/out" 'migration plan could not be computed'
grep -Fq 'password authentication failed' "$(journal_field migrate_log)" || fail 'the failed plan output was not kept in the migrate log'

# Unknown deploy arguments are refused before anything happens.
cp "$state/deploy.journal" "$tmp/journal.before"; before="$(mutations)"; before_plans="$(plans)"
for arg in 'deploy --bogus' 'deploy --allow-contract --allow-contract' 'deploy extra'; do
  run "$release" "$arg" manifest-a
  expect_rc 2 "release.sh $arg"
  need "$tmp/out" 'release.sh deploy [--allow-contract]'
  assert_untouched "release.sh $arg"
  [[ "$(plans)" == "$before_plans" ]] || fail "release.sh $arg inspected a plan"
done

# --- Failures after the switch began: prior route restored and confirmed -------
assert_rolled_back() {
  expect_rc 6 "$1"
  route_is green; caddy_is green
  running green || fail "$1 stopped the old slot"
  ! running blue || fail "$1 left the candidate running"
  cmp -s "$state/slots/blue.env" "$tmp/blue.before" || fail "$1 kept the unverified slot record"
  prev_unchanged blue || fail "$1 destroyed the existing .prev"
  journal_failed_idle "$1"
  no_temporaries "$1"; no_secrets "$1"
}
touch "$S/fail-reload-once"; run_release manifest-a
assert_rolled_back 'reload failure'
need "$tmp/out" 'restored and confirmed'
touch "$S/fail-tls-blue"; run_release manifest-a; rm -f "$S/fail-tls-blue"
assert_rolled_back 'TLS verification failure'
# After the switch the edge carries the blue header, but blue's direct probe
# reports another commit: the edge check fails and green is restored.
printf 'blue\n' > "$S/wrong-commit-on-reload"; run_release manifest-a; rm -f "$S/wrong-commit-app-blue" "$S/wrong-commit-on-reload"
assert_rolled_back 'wrong slot commit at the edge check'
[[ "$(journal_field result)" == failed:verifying ]] || fail 'a wrong slot commit at the edge check was not a verifying failure'
printf 'green\n' > "$S/stale-header"; run_release manifest-a; rm -f "$S/stale-header"
assert_rolled_back 'edge answered from the wrong slot'
touch "$S/no-header-blue"; run_release manifest-a; rm -f "$S/no-header-blue"
assert_rolled_back 'edge answered without a slot header'
printf 'verifying\n' > "$S/fail-journal-phase"; run_release manifest-a; rm -f "$S/fail-journal-phase"
assert_rolled_back 'journal failure before verifying'
# Signal while verifying: fire on the first edge request after the reload.
touch "$S/term-on-curl-after-reload"; run_release manifest-a; rm -f "$S/term-on-curl-after-reload" "$S/term-on-curl"
assert_rolled_back 'TERM during verification'
[[ "$(journal_field result)" == failed:verifying ]] || fail 'TERM during verification was not journaled as a verifying failure'

# The switch fails before the route is written: records restored, exit 6.
touch "$S/fail-record-mv-once"; run_release manifest-a; rm -f "$S/fail-record-mv-once"
assert_rolled_back 'record write failure before the route changed'
need "$tmp/out" 'the persisted route was never changed'

# A signal before any mutation (here during the edge pre-check) changes nothing.
cp "$state/deploy.journal" "$tmp/journal.signal"; before="$(mutations)"
touch "$S/term-on-curl"; run_release manifest-a; rm -f "$S/term-on-curl"
expect_rc 143 'TERM during the edge pre-check'
[[ "$(mutations)" == "$before" ]] || fail 'a signal before mutation changed Docker state'
cmp -s "$state/deploy.journal" "$tmp/journal.signal" || fail 'a signal before mutation touched the journal'

# Persistent Compose ps failure while reading the Caddy state: it is never
# mistaken for a stopped Caddy, so the restore cannot be confirmed (7).
: > "$S/calls.log"
printf '99\n' > "$S/fail-ps-state"; run_release manifest-a; rm -f "$S/fail-ps-state"
expect_rc 7 'persistent Compose ps failure'
need "$tmp/out" 'cannot determine whether Caddy is running'
[[ "$(journal_field phase)" == restore-failed ]] || fail 'Compose ps failure was treated as a stopped Caddy'
! grep -E '^docker compose .* up .*caddy$' "$S/calls.log" >/dev/null || fail 'a Compose ps failure started a second Caddy'
[[ "$(journal_field records)" == replaced ]] || fail 'the switch did not journal records=replaced'
cp "$state/deploy.journal" "$tmp/journal.crashed"
run_recover --dry-run
expect_rc 0 'recover dry run after a failed restore'
need "$tmp/out" 'serve:   app-green at'; need "$tmp/out" 'records: restore blue.env from blue.env.prev'
need "$tmp/out" 'route:   keep the route to app-green'; need "$tmp/out" 'stop:    app-blue after the edge confirms'
journal_kept 'recover --dry-run'; running blue || fail 'recover --dry-run stopped the candidate'
run_recover
assert_recovered_to_green 'recover after a persistent Compose ps failure' "$tmp/blue.before" prev
[[ "$(journal_field result)" == failed:switching ]] || fail 'recover did not keep the failed phase'
recover_again_is_noop 'recover after a persistent Compose ps failure'

# Restore also fails: a distinct exit code and a non-idle journal. A recover
# that hits the same fault fails without touching the journal; once the fault
# clears, running it again completes.
touch "$S/fail-reload-all"; run_release manifest-a
expect_rc 7 'failed restore'
need "$tmp/out" 'CRITICAL'
route_is green
[[ "$(journal_field phase)" == restore-failed ]] || fail 'failed restore reset the journal'
no_secrets 'failed restore'
run_release manifest-a
expect_rc 4 'deploy after failed restore'
cp "$state/deploy.journal" "$tmp/journal.crashed"; cp "$state/slots/blue.env" "$tmp/blue.prefail"
run_recover
expect_rc 7 'recover while Caddy cannot reload'
need "$tmp/out" 'CRITICAL'; need "$tmp/out" 'run deploy/release.sh recover again'
journal_kept 'a recover that could not reload Caddy'
running blue || fail 'a failed recover stopped the candidate before the edge confirmed the prior slot'
cmp -s "$state/slots/blue.env" "$tmp/blue.prefail" || fail 'a failed recover restored records before the edge confirmed the prior slot'
rm -f "$S/fail-reload-all"
run_recover
assert_recovered_to_green 'recover rerun after the reload fault cleared' "$tmp/blue.before" prev

touch "$S/break-tls-on-reload"; run_release manifest-a; rm -f "$S/break-tls-on-reload"
expect_rc 7 'unconfirmed restore'
need "$tmp/out" 'does not confirm app-green'
[[ "$(journal_field phase)" == restore-failed ]] || fail 'unconfirmed restore reset the journal'
route_is green; caddy_is green
cp "$state/deploy.journal" "$tmp/journal.crashed"
run_recover
expect_rc 7 'recover while the edge is broken'
need "$tmp/out" 'does not confirm app-green'
journal_kept 'a recover the edge did not confirm'
running blue || fail 'an unconfirmed recover stopped the candidate'
rm -f "$S/fail-tls-all"
run_recover
assert_recovered_to_green 'recover rerun after the edge recovered' "$tmp/blue.before" prev

# --- recover after crashes (SIGKILL) during the switch ------------------------
# A distinct pre-deploy blue record makes the record write observable.
(umask 077; printf 'IMAGE=%s\nCOMMIT=%s\nSNAPSHOT=%s\n' "$image_a" "$commit_a" "$(printf '%064d' 5).snapshot.env" > "$state/slots/blue.env")
cp "$state/slots/blue.env" "$tmp/blue.planted"

# A crash before switching (here during the migration): records=untouched.
cp "$state/slots/blue.env.prev" "$tmp/prev.premigrate"
touch "$S/kill-on-migrate"; run_release manifest-a; rm -f "$S/kill-on-migrate"; settle
expect_rc 137 'deploy killed during the migration'
[[ "$(journal_field phase)" == migrating && "$(journal_field records)" == untouched ]] || fail 'the journal after a crash during the migration is wrong'
run_recover
assert_recovered_to_green 'recover after a crash during the migration' "$tmp/blue.planted"
need "$tmp/out" 'records: leave slot records unchanged'
cmp -s "$state/slots/blue.env.prev" "$tmp/prev.premigrate" || fail 'recover after an early crash changed .prev'
[[ "$(journal_field result)" == failed:migrating ]] || fail 'recover after an early crash journaled the wrong result'

crash_switch() {
  printf '%s\n' "$1" > "$S/kill-after-mv"; run_release manifest-a; rm -f "$S/kill-after-mv"; settle
  expect_rc 137 "deploy killed after publishing $1"
  [[ "$(journal_field phase)" == switching && "$(journal_field records)" == "$2" ]] || fail "the journal after a crash at $1 is wrong"
  running blue || fail "the crash at $1 did not leave the candidate running"
  cp "$state/deploy.journal" "$tmp/journal.crashed"
}
crash_switch slots/blue.env.prev untouched
cmp -s "$state/slots/blue.env.prev" "$tmp/blue.planted" || fail 'the crash did not happen after the .prev write'
run_recover
assert_recovered_to_green 'recover after a crash after the .prev write' "$tmp/blue.planted"
need "$tmp/out" 'records: leave slot records unchanged'
crash_switch slots/blue.env replaced
! cmp -s "$state/slots/blue.env" "$tmp/blue.planted" || fail 'the crash did not happen after the record write'
run_recover
assert_recovered_to_green 'recover after a crash after the record write' "$tmp/blue.planted" prev
crash_switch routes/active-slot.caddy replaced
route_is blue; caddy_is green
run_recover
assert_recovered_to_green 'recover after a crash after the route write' "$tmp/blue.planted" prev
need "$tmp/out" 'route:   write the route to app-green (currently app-blue)'
recover_again_is_noop 'recover after a crash after the route write'

# Inside an exit-6 rollback the record is restored first, then the journal
# says records=untouched, and only then is the older .prev put back.
plant_prev blue
touch "$S/fail-tls-blue" "$S/kill-after-records-reset"; run_release manifest-a
rm -f "$S/fail-tls-blue" "$S/kill-after-records-reset"; settle
expect_rc 137 'deploy killed after the rollback journaled records=untouched'
[[ "$(journal_field phase)" == verifying && "$(journal_field records)" == untouched ]] || fail 'the rollback did not journal records=untouched'
cmp -s "$state/slots/blue.env" "$tmp/blue.planted" || fail 'the rollback journaled records=untouched before restoring the record'
cmp -s "$state/slots/blue.env.prev" "$tmp/blue.planted" || fail 'the rollback put back the older .prev before journaling records=untouched'
run_recover
assert_recovered_to_green 'recover after a crash inside the rollback' "$tmp/blue.planted"
plant_prev blue
touch "$S/fail-tls-blue" "$S/fail-records-reset"; run_release manifest-a; rm -f "$S/fail-tls-blue" "$S/fail-records-reset"
expect_rc 6 'rollback whose records=untouched journal write fails'
need "$tmp/out" 'WARNING'; need "$tmp/out" 'keeps the pre-deploy record'
cmp -s "$state/slots/blue.env" "$tmp/blue.planted" || fail 'the rollback did not restore the record'
cmp -s "$state/slots/blue.env.prev" "$tmp/blue.planted" || fail 'the rollback put back the older .prev while the journal still said replaced'
route_is green; caddy_is green; ! running blue || fail 'the rollback left the candidate running'
journal_failed_idle 'rollback whose records=untouched journal write fails'

# Deploys succeed after rollback recovers: A into blue, then B back into green.
cp "$tmp/blue.before" "$state/slots/blue.env"
run_release manifest-a
expect_rc 0 'deploy after rollback recovers'
route_is blue; caddy_is blue; ! running green || fail 'deploy after recover did not drain green'
run_release manifest-b
expect_rc 0 'second deploy after rollback recovers'
route_is green; caddy_is green; ! running blue || fail 'second deploy after recover did not drain blue'
cmp -s "$state/slots/blue.env" "$tmp/blue.before" || fail 'the blue record is not release A'

# --- Drain failure: the verified release serves, journal left non-idle --------
touch "$S/fail-stop-app-green"; run_release manifest-a; rm -f "$S/fail-stop-app-green"
expect_rc 8 'drain failure'
route_is blue; caddy_is blue
running green || fail 'drain failure claims the old slot stopped'
[[ "$(journal_field phase)" == draining && "$(journal_field result)" == verified ]] || fail 'drain failure reset the journal'
need "$state/slots/blue.env" "COMMIT=$commit_a"
run_recover --dry-run
expect_rc 0 'recover dry run after a drain failure'
need "$tmp/out" 'serve:   app-blue at'; need "$tmp/out" 'the candidate was verified at the edge'
running green || fail 'recover --dry-run drained the old slot'
cp "$state/deploy.journal" "$tmp/journal.crashed"
touch "$S/fail-ready-app-blue"; run_recover; rm -f "$S/fail-ready-app-blue"
expect_rc 7 'recover while the verified candidate is not ready'
need "$tmp/out" 'did not become ready'; need "$tmp/out" 'no fallback'
journal_kept 'recover while the verified candidate is not ready'
route_is blue; caddy_is blue
running green || fail 'recover stopped the old slot while the candidate was not ready'
running blue || fail 'recover stopped the candidate while it was not ready'
touch "$S/wrong-commit-app-blue"; run_recover; rm -f "$S/wrong-commit-app-blue"
expect_rc 7 'recover while the target reports the wrong commit'
need "$tmp/out" 'does not report release commit'
journal_kept 'recover while the target reports the wrong commit'
route_is blue; caddy_is blue; running green || fail 'recover stopped the old slot while the target reported the wrong commit'
# The target slot and PostgreSQL are stopped (for example after a reboot):
# recover starts PostgreSQL, then the target on its recorded image.
rm -f "$S/running-app-blue" "$S/running-postgres"
: > "$S/calls.log"
run_recover
expect_rc 0 'recover after a drain failure'
grep -E '^docker compose .* up -d --no-build --pull never --wait --wait-timeout [0-9]+ postgres$' "$S/calls.log" >/dev/null || fail 'recover did not start PostgreSQL'
grep -E '^docker compose .* up -d --no-build --pull never --no-deps app-blue$' "$S/calls.log" >/dev/null || fail 'recover did not start the stopped target slot'
[[ "$(line_of 'up .*postgres$')" -lt "$(line_of 'up .*app-blue$')" ]] || fail 'recover started the target before PostgreSQL'
! grep -E '^docker compose .* up .*app-green$' "$S/calls.log" >/dev/null || fail 'recover started the other slot'
route_is blue; caddy_is blue
running blue && [[ "$(< "$S/running-app-blue")" == "$image_a" ]] || fail 'recover changed the verified release'
! running green || fail 'recover did not drain the old slot'
[[ "$(journal_field phase)" == idle && "$(journal_field result)" == success ]] || fail 'recover did not reset the journal to success'
need "$state/slots/blue.env" "COMMIT=$commit_a"; need "$state/slots/green.env" "COMMIT=$commit_b"
recover_again_is_noop 'recover after a drain failure'

printf 'draining\n' > "$S/fail-journal-phase"; run_release manifest-b; rm -f "$S/fail-journal-phase"
expect_rc 8 'journal failure before draining'
route_is green; caddy_is green
running blue || fail 'old slot stopped without a draining journal entry'
[[ "$(journal_field phase)" == verifying && "$(journal_field result)" == verified ]] || fail 'the verified marker was not journaled before draining'
run_recover
expect_rc 0 'recover after a journal failure before draining'
route_is green; caddy_is green
running green || fail 'recover stopped the verified release'
! running blue || fail 'recover did not drain the old slot'
[[ "$(journal_field phase)" == idle && "$(journal_field result)" == success ]] || fail 'recover did not reset the journal to success'

# --- Rollback by redeploying the previous manifest, with transient faults -------
: > "$S/calls.log"
printf '2\n' > "$S/flaky-ready-app-blue"; printf '1\n' > "$S/fail-ps-state"; printf '1\n' > "$S/restarting-caddy"
run_release manifest-a MAWAREETH_DEPLOY_READY_TIMEOUT=20
rm -f "$S/flaky-ready-app-blue" "$S/fail-ps-state" "$S/restarting-caddy"
expect_rc 0 'redeploy previous manifest with transient probe and Compose faults'
[[ "$(grep -cE 'exec -T app-blue python .*/health/ready/ ' "$S/calls.log")" -ge 3 ]] || fail 'readiness was not retried'
[[ "$(grep -cE 'ps --all --format .* caddy$' "$S/calls.log")" -ge 3 ]] || fail 'the Caddy state query was not retried'
route_is blue; caddy_is blue
[[ "$(< "$S/running-app-blue")" == "$image_a" ]] || fail 'blue does not run release A'
! running green || fail 'green was not drained'
need "$state/slots/blue.env.prev" "COMMIT=$commit_a"
[[ "$(journal_field phase)" == idle && "$(journal_field prior_slot)" == green && "$(journal_field prior_commit)" == "$commit_b" ]] || fail 'journal is wrong after rollback deploy'

# --- A deliberate contract release with --allow-contract ----------------------
printf '%s\n' 'Planned operations:' 'calc.0046_contract' '    Remove field legacy_share from heir' > "$S/plan-output"
: > "$S/calls.log"; before_migrations="$(migrations)"
run "$release" 'deploy --allow-contract' manifest-b
rm -f "$S/plan-output"
expect_rc 0 'contract release with --allow-contract'
route_is green; caddy_is green
[[ "$(migrations)" == $((before_migrations + 1)) ]] || fail '--allow-contract did not migrate exactly once'
[[ "$(line_of 'migrate --plan --no-color$')" -lt "$(line_of 'migrate --noinput$')" ]] || fail '--allow-contract skipped the plan'
need "$tmp/out" 'allowed by --allow-contract'
! grep -Fq 'legacy_share' "$tmp/out" || fail '--allow-contract showed the plan on the terminal'
need "$(journal_field deploy_log)" 'allowed by --allow-contract'
need "$(journal_field migrate_log)" 'contract operations allowed by --allow-contract'
need "$(journal_field migrate_log)" '    Remove field legacy_share from heir'
no_secrets 'contract release with --allow-contract'

# --- EDGE_MODE=cloudflare: the re-bootstrap to the production edge ------------
# Switching a running acme host to cloudflare changes Caddy's Compose model, so
# a normal deploy refuses the running Caddy as stale. The supported path is the
# re-bootstrap in deploy/README.md: stop the slots and Caddy, archive the release
# state, install the production runtime file (DOMAIN=www.example.com,
# REDIRECT_DOMAIN=example.com), prepare, and bootstrap. Every edge probe then
# verifies against the bundle's pinned Origin CA roots, and the redirect site is
# probed too. OpenSSL builds the Origin certificate; it is required in CI.
if ! command -v openssl >/dev/null 2>&1; then
  [[ -z "${CI:-}" ]] || fail 'openssl is required in CI'
  printf 'NOTE: openssl is unavailable; skipping the cloudflare re-bootstrap checks\n' >&2
  printf '%s\n' 'release offline checks passed'
  exit 0
fi
origin_work="$(mktemp -d)"
(
  cd "$origin_work" || exit 1
  printf '%s\n' '[req]' 'prompt = no' 'distinguished_name = dn' '[dn]' 'CN = origin.invalid' > openssl.cnf
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 30 -config openssl.cnf \
    -addext 'subjectAltName=DNS:example.com,DNS:*.example.com' -keyout key.pem -out cert.pem
) >/dev/null 2>&1 || fail 'could not generate the Origin certificate fixture'
mkdir -p "$tmp/origin-tls"; cp "$origin_work/cert.pem" "$origin_work/key.pem" "$tmp/origin-tls/"; rm -rf "$origin_work"
chmod 700 "$tmp/origin-tls"; chmod 600 "$tmp/origin-tls/cert.pem" "$tmp/origin-tls/key.pem"
key_line="$(sed -n 2p "$tmp/origin-tls/key.pem")"
[[ -n "$key_line" ]] || fail 'the Origin key fixture is empty'
origin_env=(MAWAREETH_ORIGIN_TLS_DIR="$tmp/origin-tls")
# The snapshot an acme host with the same DOMAIN would get.
sed 's/^DOMAIN=example\.com$/DOMAIN=www.example.com/' "$tmp/runtime.env" > "$tmp/runtime-www-acme.env"; chmod 600 "$tmp/runtime-www-acme.env"
run_runtime prepare manifest-a MAWAREETH_RUNTIME_FILE="$tmp/runtime-www-acme.env" MAWAREETH_RUNTIME_DIR="$tmp/acme-www-state"
expect_rc 0 'acme prepare for the production DOMAIN'
acme_www_snapshots=("$tmp/acme-www-state"/*.snapshot.env)
[[ ${#acme_www_snapshots[@]} == 1 && -f "${acme_www_snapshots[0]}" ]] || fail 'acme prepare for the production DOMAIN did not create one snapshot'

# Re-bootstrap: nothing runs, and the release state is archived.
rm -f "$S"/running-*
mkdir -p "$tmp/archive"
shopt -s nullglob
for item in "$state/slots" "$state/routes" "$state/deploy.journal" "$state"/*.snapshot.env; do mv "$item" "$tmp/archive/"; done
shopt -u nullglob
{ cat "$tmp/runtime-www-acme.env"; printf '%s\n' EDGE_MODE=cloudflare REDIRECT_DOMAIN=example.com; } > "$tmp/runtime.env"; chmod 600 "$tmp/runtime.env"
printf 'www.example.com\n' > "$S/edge-host"; printf 'example.com\n' > "$S/redirect-host"
printf '%s\n' "$bundle/deploy/cloudflare-origin-ca.pem" > "$S/origin-ca"

# A missing Origin key is refused before any change, naming only the path.
mv "$tmp/origin-tls/key.pem" "$tmp/origin-key.moved"
: > "$S/calls.log"
run_runtime prepare manifest-a "${origin_env[@]}"
expect_rc 2 'cloudflare prepare without the Origin key'
need "$tmp/out" "$tmp/origin-tls/key.pem"
[[ ! -e "$state/routes" && ! -e "$state/slots" && "$(snapshot_count)" == 0 ]] || fail 'cloudflare prepare without the Origin key changed runtime state'
[[ "$(mutations)" == 0 ]] || fail 'cloudflare prepare without the Origin key mutated Docker state'
mv "$tmp/origin-key.moved" "$tmp/origin-tls/key.pem"

run_runtime prepare manifest-a "${origin_env[@]}"
expect_rc 0 'cloudflare prepare'
[[ "$(snapshot_count)" == 1 && -f "$state/${acme_www_snapshots[0]##*/}" ]] || fail 'the edge keys changed the app snapshot'
cmp -s "$state/${acme_www_snapshots[0]##*/}" "${acme_www_snapshots[0]}" || fail 'the cloudflare snapshot differs from the acme one'
route_is blue
: > "$S/calls.log"
run_release manifest-a "${origin_env[@]}"
expect_rc 0 'cloudflare bootstrap'
route_is blue; caddy_is blue
grep -Eq '^curl .*--resolve www\.example\.com:443:127\.0\.0\.1 .*https://www\.example\.com/health/ready/$' "$S/calls.log" \
  || fail 'the cloudflare bootstrap did not verify the canonical name'
grep -Eq '^curl .*--resolve example\.com:443:127\.0\.0\.1 .*https://example\.com/$' "$S/calls.log" \
  || fail 'the cloudflare bootstrap did not probe the redirect site'
! grep -E '^curl ' "$S/calls.log" | grep -Fv -- "--cacert $bundle/deploy/cloudflare-origin-ca.pem " >/dev/null \
  || fail 'a cloudflare edge probe did not pin the Origin CA roots'
! grep -Fq -- "$key_line" "$tmp/out" || fail 'the cloudflare bootstrap printed Origin key material'
no_secrets 'cloudflare bootstrap'

# A redirect site that does not answer 301 to the canonical name fails the
# verification and rolls back like any edge failure.
: > "$S/calls.log"; touch "$S/fail-redirect"
run_release manifest-b "${origin_env[@]}"
rm -f "$S/fail-redirect"
expect_rc 6 'cloudflare deploy with a broken redirect site'
need "$tmp/out" 'https://example.com/ did not answer a 301 redirect to https://www.example.com/'
route_is blue; caddy_is blue
running blue || fail 'the redirect failure stopped the prior slot'
! running green || fail 'the redirect failure left the candidate running'
journal_failed_idle 'cloudflare deploy with a broken redirect site'
: > "$S/calls.log"
run_release manifest-b "${origin_env[@]}"
expect_rc 0 'cloudflare deploy'
route_is green; caddy_is green
grep -Eq '^curl .*--resolve example\.com:443:127\.0\.0\.1 .*https://example\.com/$' "$S/calls.log" \
  || fail 'the cloudflare deploy did not probe the redirect site'
no_secrets 'cloudflare deploy'

printf '%s\n' 'release offline checks passed'
