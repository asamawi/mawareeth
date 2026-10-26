#!/usr/bin/env bash
# shellcheck disable=SC2016 # literal $ patterns are intentional in assertions.
# Offline tests for deploy/rehearse.sh. Docker (and through it Compose, psql,
# pg_dump, pg_restore, and the Heroku source), flock, date, and (when
# unprivileged) stat, install, and chown are stubbed, and the host sampler is
# replaced by fixtures; nothing touches the network, Heroku, a registry, host
# Docker state, or this checkout. deploy/tests/test_rehearsal.py covers
# rehearsal.py itself.
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
fail() { printf 'FAIL: %s\n' "$*" >&2; [[ ! -f "${tmp:-}/out" ]] || sed 's/^/  | /' "$tmp/out" >&2; exit 1; }
need() { grep -Fq -- "$2" "$1" || fail "missing $2 in $1"; }
lacks() { ! grep -Fq -- "$2" "$1" || fail "unexpected $2 in $1"; }

rehearse_src="$root/deploy/rehearse.sh"
bash -n "$rehearse_src" "$root/deploy/backup.sh" "$root/deploy/runtime.sh" "$0"
! grep -Eq '\|\|[[:space:]]*(true|:)([[:space:]]|$|;)' "$rehearse_src" || fail 'rehearse.sh must not mask failures with || true'
! grep -Eq -- '-e +"?PG(PASSWORD|HOST|USER|DATABASE|PORT)|postgres(ql)?://' "$rehearse_src" || fail 'rehearse.sh must pass source credentials only through --env-file'
! grep -Eiq 'maintenance:on|maintenance:off' "$rehearse_src" || fail 'rehearse.sh must never toggle Heroku maintenance mode'
! grep -Eq 'atomic_write "\$route_file"|seed_route|write_snapshot|caddy reload' "$rehearse_src" || fail 'rehearse.sh must never change the route or snapshots'
grep -Fq 'PGSSLMODE=require' "$rehearse_src" || fail 'rehearse.sh must force PGSSLMODE=require'
grep -Fq 'METHODS = ("GET", "HEAD")' "$root/deploy/rehearsal.py" || fail 'the load generator may send only GET and HEAD'

real_stat="$(command -v stat)"; real_install="$(command -v install)"; real_date="$(command -v date)"; real_sync="$(command -v sync)"
tmp="$(mktemp -d)"; [[ -z "${KEEP_TMP:-}" ]] || echo "$tmp" >&2
case "$tmp" in "$root"/*) fail 'temporary directory must be outside the checkout' ;; esac
trap '[[ -n "${KEEP_TMP:-}" ]] || rm -rf "$tmp"' EXIT
stub="$tmp/bin"; S="$tmp/docker-state"; state="$tmp/state"; bundle="$tmp/bundle"; etc="$tmp/etc"
mkdir -p "$stub" "$S" "$state" "$bundle/deploy" "$etc"
chmod 700 "$state"

# A disposable bundle; only the root execution gate is relaxed when
# unprivileged. The host sampler is a fixture; evaluate and loadgen are real.
cp "$root/deploy/runtime-images.lock" "$bundle/deploy/"
for script in runtime.sh backup.sh rehearse.sh; do
  if [[ ${EUID:-999} -ne 0 ]]; then
    sed 's/\[\[ ${EUID:-999} -eq 0 \]\]/[[ 0 -eq 0 ]]/' "$root/deploy/$script" > "$bundle/deploy/$script"
    ! grep -Fq 'EUID' "$bundle/deploy/$script" || fail "root-gate patch was not applied to $script"
  else
    cp "$root/deploy/$script" "$bundle/deploy/$script"
  fi
done
chmod 644 "$bundle/deploy/runtime-images.lock"
cp "$root/deploy/rehearsal.py" "$bundle/deploy/rehearsal-real.py"
cat > "$bundle/deploy/rehearsal.py" <<'EOF'
import os, subprocess, sys, time
S = '__S__'
if sys.argv[1] == 'sample':
    open(os.path.join(S, 'sampler-started'), 'w').close()
    if os.path.exists(os.path.join(S, 'sampler-hang')):
        time.sleep(60)
    if os.path.exists(os.path.join(S, 'fail-sampler')):
        sys.exit(1)
    sys.stdout.write(open(os.path.join(S, 'samples.tsv')).read())
    sys.exit(0)
real = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rehearsal-real.py')
sys.exit(subprocess.call([sys.executable, '-I', real] + sys.argv[1:]))
EOF
rehearse="$bundle/deploy/rehearse.sh"

secret='HerokuSourcePassword-NEVER-PRINT-0123456789abcdef'
source_host='ec2-1-2-3-4.compute-1.amazonaws.com'
write_source() {
  printf 'PGHOST=%s\nPGPORT=5432\nPGDATABASE=d0abc123\nPGUSER=u0abc123\nPGPASSWORD=%s\n' "$source_host" "$secret" > "$etc/heroku-source.env"
  chmod 600 "$etc/heroku-source.env"
}
write_source
cat > "$etc/runtime.env" <<'EOF'
DOMAIN=example.com
APP_IMAGE_REPOSITORY=ghcr.io/example/mawareeth
POSTGRES_DB=mawareeth
POSTGRES_USER=mawareeth
POSTGRES_PASSWORD=LongUrlSafePassword_123456
DJANGO_KEY=a-long-django-key-that-is-never-printed-1234567890
MAILGUN_ACCESS_KEY=mailgun-secret-value
MAILGUN_SERVER_NAME=mg.example.com
EOF
chmod 600 "$etc/runtime.env"
printf '%s\n' "$secret" 'postgres://' 'postgresql://' 'PGPASSWORD=' > "$S/leak-patterns"

# Runtime state: blue is active and recorded; green gets a record later.
mkdir -p "$state/routes" "$state/slots"; chmod 755 "$state/routes"; chmod 700 "$state/slots"
env MAWAREETH_RUNTIME_IMAGE_LOCK="$bundle/deploy/runtime-images.lock" bash -c 'source "$1"; route_content blue' _ "$bundle/deploy/runtime.sh" > "$state/routes/active-slot.caddy"
chmod 644 "$state/routes/active-slot.caddy"; cp "$state/routes/active-slot.caddy" "$tmp/route.before"
make_snapshot() { local hash; printf 'SNAPSHOT=%s\n' "$1" > "$tmp/snap"; hash="$(sha256sum "$tmp/snap" | cut -d' ' -f1)"; mv "$tmp/snap" "$state/$hash.snapshot.env"; chmod 600 "$state/$hash.snapshot.env"; printf '%s.snapshot.env\n' "$hash"; }
snap_blue="$(make_snapshot blue)"; snap_green="$(make_snapshot green)"
img_blue="ghcr.io/example/mawareeth@sha256:$(printf 'b%.0s' {1..64})"; img_green="ghcr.io/example/mawareeth@sha256:$(printf 'c%.0s' {1..64})"
slot_record() { printf 'IMAGE=%s\nCOMMIT=%s\nSNAPSHOT=%s\n' "$1" "$(printf 'd%.0s' {1..40})" "$2"; }
slot_record "$img_blue" "$snap_blue" > "$state/slots/blue.env"; chmod 600 "$state/slots/blue.env"

# The source snapshot: "<key><TAB>count<TAB>checksum" rows.
source_counts=$'public.auth_user\t3\t-4611686018427387904\npublic.django_migrations\t42\t8070450532247928832\npublic.estate\t7\t123456789'
printf '%s\n' "$source_counts" > "$S/source-counts"
printf '%s\n' "SET TimeZone = 'UTC';" "SET DateStyle = 'ISO, YMD';" "SET IntervalStyle = 'postgres';" \
  "SET extra_float_digits = 1;" "SET bytea_output = 'hex';" "SET lc_monetary = 'C';" "SET search_path = '';" > "$S/expected-settings"
touch "$S/running-postgres" "$S/running-app-blue"

# Docker stub. Containers of Compose services are marker files
# $S/running-<service>; the private PostgreSQL is container abcdef123456 and
# keeps restored rows in $S/target-restored. `docker run` of the PostgreSQL
# image is a Heroku source session: it requires the credentials in its
# --env-file, PGSSLMODE=require, and a read-only session. Markers in $S inject
# failures.
cat > "$stub/docker" <<'EOF'
#!/usr/bin/env bash
S='__S__'
printf 'docker %s\n' "$*" >> "$S/calls.log"
prod=abcdef123456
case "${1:-} ${2:-}" in
  'image inspect')
    image="${*: -1}"
    if [[ "$*" == *RepoDigests* ]]; then
      tagged="${image%@*}"; repo="$tagged"
      [[ "${tagged##*/}" != *:* ]] || repo="${tagged%:*}"
      printf '%s@%s\n' "$repo" "${image##*@}"
    else printf 'sha256:%064d\n' 1; fi
    exit 0 ;;
  'compose --project-name'|'compose version')
    [[ "$2" != version ]] || exit 0
    service="${*: -1}"
    if [[ " $* " == *' up '* ]]; then
      printf 'APP_SNAPSHOT=%s\nAPP_BLUE_IMAGE=%s\nAPP_GREEN_IMAGE=%s\nROUTES_DIR=%s\n' "$APP_SNAPSHOT" "$APP_BLUE_IMAGE" "$APP_GREEN_IMAGE" "$ROUTES_DIR" > "$S/compose-env"
      touch "$S/running-$service"
      [[ ! -e "$S/fail-compose-up" ]] || exit 1
      exit 0
    fi
    if [[ " $* " == *' stop '* ]]; then
      [[ ! -e "$S/fail-compose-stop" ]] || exit 1
      rm -f "$S/running-$service"; printf '%s\n' "$service" >> "$S/stops"; exit 0
    fi
    exit 1 ;;
  'ps -q')
    all="$*"; service="${all##*com.docker.compose.service=}"
    [[ "$*" == *label=com.docker.compose.project=mawareeth* && -e "$S/running-$service" ]] || exit 0
    if [[ "$service" == postgres ]]; then echo "$prod"; else echo 0123456789ab; fi
    exit 0 ;;
  'ps -a')
    # A source session that outlived its client, until it is reaped.
    [[ "$*" != *label=com.mawareeth.rehearsal-run=* || ! -e "$S/source-leftover" ]] || echo feedface0001
    exit 0 ;;
  'rm -f')
    [[ "${*: -1}" != feedface0001 ]] || { rm -f "$S/source-leftover"; echo feedface0001 >> "$S/reaped"; }
    exit 0 ;;
  'run --rm')
    args=("$@"); envfile=''; envs=' '; image=-1
    for i in "${!args[@]}"; do
      case "${args[$i]}" in
        --env-file) envfile="${args[$((i + 1))]}" ;;
        -e) envs+="${args[$((i + 1))]} " ;;
        docker.io/library/postgres:*) image="$i"; break ;;
      esac
    done
    ((image > 0)) || exit 125
    # Compared in memory, so no stub argv ever holds the password.
    expected="$(grep '^PGPASSWORD=' '__ETC__/heroku-source.env')"; given="$(grep '^PGPASSWORD=' "$envfile" 2>/dev/null)" || given=''
    [[ -n "$given" && "$given" == "$expected" ]] || { echo 'no credentials in --env-file' >&2; exit 9; }
    [[ "$envs" == *' PGSSLMODE=require '* && "$envs" == *' PGOPTIONS=-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=0 -c statement_timeout=0 '* ]] \
      || { echo 'source session is not TLS, read only, and without session timeouts' >&2; exit 9; }
    touch "$S/source-env-ok"
    rest=("${args[@]:$((image + 1))}")
    [[ "${rest[0]}" == timeout && "${rest[1]}" =~ ^[0-9]+$ ]] || exit 9
    program="${rest[2]}"
    case "$program" in
      psql)
        echo "${rest[1]}" > "$S/psql-timeout"
        touch "$S/source-leftover"
        while IFS= read -r line; do
          case "$line" in
            'BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;') echo open > "$S/source-txn"; : > "$S/source-settings" ;;
            'SELECT pg_export_snapshot();')
              [[ ! -e "$S/source-unreachable" ]] || { echo 'psql: error: connection refused' >&2; exit 2; }
              echo '00000003-0000001B-1' ;;
            'SHOW server_version_num;') cat "$S/source-version" 2>/dev/null || echo 170010 ;;
            *pg_largeobject_metadata*) cat "$S/source-largeobjects" 2>/dev/null || echo 0 ;;
            *pg_extension*) cat "$S/source-extensions" 2>/dev/null || echo '' ;;
            *string_agg*) cat "$S/source-schemas" 2>/dev/null || echo '' ;;
            'SET '*) printf '%s\n' "$line" >> "$S/source-settings" ;;
            *pg_sequences*'\gexec') cat "$S/source-sequences" ;;
            "SELECT 'mawareeth-sequences-end';") echo mawareeth-sequences-end ;;
            *'\gexec')
              cmp -s "$S/source-settings" "$S/expected-settings" || { echo 'checksum query before the output settings' >&2; exit 3; }
              if [[ -e "$S/hang-count" ]]; then touch "$S/count-started"; sleep 8; fi
              cat "$S/source-counts" ;;
            "SELECT 'mawareeth-counts-end';") echo mawareeth-counts-end ;;
            'COMMIT;') echo committed > "$S/source-txn" ;;
            *) echo "unexpected SQL: $line" >&2; exit 3 ;;
          esac
        done
        rm -f "$S/source-leftover"
        exit 0 ;;
      pg_dump)
        printf '%s\n' "${rest[*]:2}" > "$S/dump-args"
        cat "$S/source-txn" > "$S/dump-txn"
        if [[ -e "$S/scan-argv" ]]; then
          # Every process argv on the system while the import runs.
          cat /proc/[0-9]*/cmdline 2>/dev/null | tr '\0' '\n' | grep -cFf "$S/leak-patterns" > "$S/argv-leaks" || :
          ls -d /proc/[0-9]* 2>/dev/null | wc -l > "$S/argv-scanned"
        fi
        printf 'PGDMP'
        if [[ -e "$S/fail-pg-dump" ]]; then head -n 1 "$S/source-counts"; echo 'pg_dump: error: connection lost' >&2; exit 1; fi
        cat "$S/source-counts"; exit 0 ;;
    esac
    exit 9 ;;
esac
[[ "${1:-}" == exec ]] || exit 1
shift; [[ "$1" != -i ]] || shift
[[ "$1" == "$prod" && -e "$S/running-postgres" ]] || exit 1
shift
[[ "$1" == timeout && "$2" =~ ^[0-9]+$ ]] || exit 1
shift 2
case "$1" in
  psql)
    : > "$S/target-settings"
    while IFS= read -r line; do
      case "$line" in
        *pg_depend*pg_proc*)
          [[ "$line" == *"relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')"* && "$line" == *"deptype = 'e'"* ]] || exit 3
          if [[ -s "$S/target-restored" ]]; then grep -c . "$S/target-restored"; else cat "$S/target-objects" 2>/dev/null || echo 0; fi ;;
        *pg_extension*) cat "$S/target-extensions" 2>/dev/null || echo '' ;;
        'ANALYZE;') touch "$S/analyzed" ;;
        'SET '*) printf '%s\n' "$line" >> "$S/target-settings" ;;
        *pg_sequences*'\gexec')
          if [[ -e "$S/sequence-drift" ]]; then sed 's/\t[0-9]*\t/\t1\t/' "$S/target-sequences"; else cat "$S/target-sequences" 2>/dev/null || :; fi ;;
        *'\gexec')
          cmp -s "$S/target-settings" "$S/expected-settings" || { echo 'checksum query before the output settings' >&2; exit 3; }
          if [[ -e "$S/restore-corrupt" ]]; then sed 's/^\(public\.estate\t[0-9]*\)\t.*$/\1\t42/' "$S/target-restored"; else cat "$S/target-restored"; fi ;;
        *) exit 3 ;;
      esac
    done
    exit 0 ;;
  pg_restore)
    printf '%s\n' "${*:2}" > "$S/restore-args"
    data="$(cat)"; [[ "$data" == PGDMP* ]] || exit 1
    # --single-transaction: a failed restore leaves nothing behind.
    [[ ! -e "$S/fail-pg-restore" ]] || exit 1
    printf '%s\n' "${data#PGDMP}" > "$S/target-restored"
    cp "$S/source-sequences" "$S/target-sequences"
    exit 0 ;;
esac
exit 1
EOF
# flock -n FD fails while "$S/lock-held-FD" exists (9: deploy, 8: backup).
cat > "$stub/flock" <<'EOF'
#!/usr/bin/env bash
[[ ! -e "__S__/lock-held-${*: -1}" ]]
EOF
# A controllable clock: `date +%s` answers "$S/clock-fixed" when it exists.
cat > "$stub/date" <<'EOF'
#!/usr/bin/env bash
out="$('__DATE__' "$@")" || exit $?
if [[ "${*: -1}" == +%s && -e '__S__/clock-fixed' ]]; then out="$(< '__S__/clock-fixed')"; fi
printf '%s\n' "$out"
EOF
sed -i "s|__S__|$S|g; s|__DATE__|$real_date|g; s|__ETC__|$etc|g" "$stub/docker" "$stub/flock" "$stub/date"
# A native Python on Windows needs a native path.
S_native="$S"; if command -v cygpath >/dev/null 2>&1; then S_native="$(cygpath -m "$S")"; fi
sed -i "s|__S__|$S_native|g" "$bundle/deploy/rehearsal.py"
! grep -Fq '__' "$stub/docker" "$stub/flock" "$stub/date" || fail 'stub placeholders were not substituted'
chmod +x "$stub/docker" "$stub/flock" "$stub/date"

printf 'probe\n' > "$tmp/sync-probe"
if ! "$real_sync" -- "$tmp/sync-probe" 2>/dev/null; then
  printf '#!/usr/bin/env bash\nexit 0\n' > "$stub/sync"; chmod +x "$stub/sync"
fi
# Unprivileged runs report the ownership and modes root would establish;
# "$S/mode-<basename>" overrides one file.
if [[ ${EUID:-999} -ne 0 ]]; then
  cat > "$stub/stat" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == -c && "$2" == '%u:%g:%a' ]]; then
  if [[ -e "__S__/mode-${3##*/}" ]]; then cat "__S__/mode-${3##*/}"; exit 0; fi
  [[ -e "$3" ]] || exit 1
  case "$3" in
    *runtime-images.lock|*/active-slot.caddy) printf '0:0:644\n' ;;
    */routes) printf '0:0:755\n' ;;
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
  chmod +x "$stub/stat" "$stub/chown" "$stub/install"
fi

base_env=(PATH="$stub:$PATH" MAWAREETH_RUNTIME_FILE="$etc/runtime.env" MAWAREETH_RUNTIME_DIR="$state" MAWAREETH_BACKUP_CONFIG_DIR="$etc"
  MAWAREETH_HEROKU_SOURCE_FILE="$etc/heroku-source.env" MAWAREETH_REHEARSAL_SAMPLE_INTERVAL=15 MAWAREETH_REHEARSAL_LOAD_WAIT=5
  MAWAREETH_REHEARSAL_IMPORT_TIMEOUT=120 MAWAREETH_RUNTIME_WAIT_TIMEOUT=30)
rc=0
# run [ENV=VALUE...] ARGS... (the load summary comes from "$S/load")
run() {
  local -a envs=() args=()
  while (($#)) && [[ "$1" == *=* && "$1" != -* ]]; do envs+=("$1"); shift; done
  args=("$@")
  : > "$S/calls.log"
  set +e
  env "${base_env[@]}" "${envs[@]}" bash "$rehearse" "${args[@]}" < "${load_input:-/dev/null}" > "$tmp/out" 2>&1
  rc=$?
  set -e
}
expect_rc() { [[ "$rc" == "$1" ]] || fail "$2: expected exit $1, got $rc"; }
field() { grep -E "^$2=" "$1" | head -n 1 | cut -d= -f2-; }
evidence_is() { [[ "$(field "$state/rehearsal/$1" result)" == "$2" ]] || fail "$1 evidence is $(field "$state/rehearsal/$1" result), not $2"; }
docker_runs() { grep -c '^docker run' "$S/calls.log" || :; }
no_secrets() {
  ! grep -rEq 'NEVER-PRINT|postgres(ql)?://|LongUrlSafePassword_123456|a-long-django-key' "$tmp/out" "$S/calls.log" "$state" \
    || fail "$1 leaked a source credential or URL into argv, output, logs, or evidence"
  ! grep -Eq "PGPASSWORD|PGHOST|$source_host" "$S/calls.log" || fail "$1 put source credentials on a docker command line"
}
route_unchanged() { cmp -s "$tmp/route.before" "$state/routes/active-slot.caddy" || fail "$1 changed the route"; }
# gen_samples CPU% MEM% MINUTES [SWAP] [OOM]: a 15-second sample file.
gen_samples() {
  awk -v cpu="$1" -v mem="$2" -v minutes="$3" -v swap="${4:-0}" -v oom="${5:-0}" 'BEGIN {
    OFS = "\t"; print "epoch", "cpu_busy", "cpu_total", "mem_total_kb", "mem_available_kb", "pswpin", "pswpout", "oom_kill"
    n = minutes * 4
    for (i = 0; i <= n; i++) {
      last = (i == n)
      print 1000000 + 15 * i, int(i * 10 * cpu + 0.5), i * 1000, 8000000, int(8000000 * (1 - mem / 100)), last ? swap : 0, 0, last ? oom : 0
    }
  }' > "$S/samples.tsv"
}
# load_summary REQUESTS ERRORS [SECONDS [STARTED [FINISHED]]]: by default the
# load covers every 30-minute fixture (epochs 1000000-1001800) with margin.
load_summary() {
  printf 'result=pass\nrequests=%s\nerrors=%s\nerror_rate_percent=0.000\np95_ms=120.5\nrequests_per_second=10.00\nseconds=%s\nstarted_epoch=%s\nfinished_epoch=%s\n' \
    "$1" "$2" "${3:-1920.4}" "${4:-999940}" "${5:-1001860}" > "$S/load"
}
printf 'public.auth_user_id_seq\t3\tt\npublic.estate_id_seq\t7\tt\n' > "$S/source-sequences"

# --- mark and an empty report -------------------------------------------------
run mark freeze
expect_rc 2 'unknown phase'
need "$tmp/out" 'usage: rehearse.sh mark {ttl-lowered|freeze-start|validated|dns-switched|dns-rolled-back|rollback-point}'
run report
expect_rc 1 'report without evidence'
for text in 'no import evidence' 'no capacity evidence' 'no readable restore evidence' 'the ttl-lowered mark is missing' 'the rollback-point mark is missing'; do need "$tmp/out" "$text"; done
need "$state/rehearsal/report" 'gate=unmet'
need "$state/rehearsal/report" 'path=undetermined'

# --- import refusals: nothing contacts the source or writes the target --------
printf '0:0:644\n' > "$S/mode-heroku-source.env"; [[ ${EUID:-999} -ne 0 ]] || chmod 644 "$etc/heroku-source.env"
run import; rm -f "$S/mode-heroku-source.env"; chmod 600 "$etc/heroku-source.env"
expect_rc 2 'world-readable source file'; need "$tmp/out" 'Heroku source file must be owned by root:root with mode 600'
[[ "$(docker_runs)" == 0 ]] || fail 'a refused source file contacted the source'
printf 'PGSSLMODE=disable\n' >> "$etc/heroku-source.env"
run import; write_source
expect_rc 2 'unsupported source key'; need "$tmp/out" 'unsupported key: PGSSLMODE'
sed -i '/^PGPORT=/d' "$etc/heroku-source.env"
run import; write_source
expect_rc 2 'missing source key'; need "$tmp/out" 'missing required key: PGPORT'
printf 'PGHOST=%s \n' "$source_host" > "$etc/heroku-source.env.bad"; cat "$etc/heroku-source.env" >> "$etc/heroku-source.env.bad"; mv "$etc/heroku-source.env.bad" "$etc/heroku-source.env"; chmod 600 "$etc/heroku-source.env"
run import; write_source
expect_rc 2 'whitespace in the source file'
[[ "$(docker_runs)" == 0 ]] || fail 'a malformed source file contacted the source'
no_secrets 'source file refusals'

touch "$S/lock-held-9"; run import; rm -f "$S/lock-held-9"
expect_rc 3 'deploy lock held'; need "$tmp/out" 'holds'
touch "$S/lock-held-8"; run import; rm -f "$S/lock-held-8"
expect_rc 3 'backup lock held'
run import
expect_rc 2 'running slot'; need "$tmp/out" 'app-blue is running'
rm -f "$S/running-app-blue"
echo 3 > "$S/target-objects"; run import; rm -f "$S/target-objects"
expect_rc 2 'target not empty'; need "$tmp/out" 'already holds 3 user objects (relations, sequences, views, types, or functions)'
[[ "$(docker_runs)" == 0 ]] || fail 'a refused target contacted the source'
# A view, type, or function without any table still counts as data.
echo 1 > "$S/target-objects"; run import; rm -f "$S/target-objects"
expect_rc 2 'target holding only a non-table object'; need "$tmp/out" 'already holds 1 user objects'
echo 3 > "$S/source-largeobjects"; run import; rm -f "$S/source-largeobjects"
expect_rc 2 'source large objects'; need "$tmp/out" 'the source holds 3 large objects'
lacks "$S/calls.log" 'pg_dump'
echo 'citext,pgcrypto' > "$S/source-extensions"; run import
expect_rc 2 'source extensions'; need "$tmp/out" 'the source uses extensions this import does not create: citext,pgcrypto'
lacks "$S/calls.log" 'pg_dump'
echo 'citext' > "$S/target-extensions"; run import --extensions-created
expect_rc 2 'extensions missing on the target'; need "$tmp/out" '--extensions-created, but the target lacks: pgcrypto'
lacks "$S/calls.log" 'pg_dump'
rm -f "$S/source-extensions" "$S/target-extensions"
[[ ! -e "$state/rehearsal/import" ]] || fail 'a refused import wrote evidence'
echo 'audit,heroku_ext' > "$S/source-schemas"; run import; rm -f "$S/source-schemas"
expect_rc 2 'non-public source tables'; need "$tmp/out" 'outside the public schema, which this import does not copy: audit,heroku_ext'
lacks "$S/calls.log" 'pg_dump'; lacks "$S/calls.log" 'pg_restore'
[[ ! -e "$state/rehearsal/import" && ! -e "$state/rehearsal/mark-freeze-start" ]] || fail 'a refused import wrote evidence or a mark'
echo 160004 > "$S/source-version"; run import; rm -f "$S/source-version"
expect_rc 2 'source major differs'; need "$tmp/out" 'the source runs PostgreSQL 16'
run import --freeze-marked
expect_rc 2 '--freeze-marked without a mark'

# --- import failures ----------------------------------------------------------
touch "$S/source-unreachable"; run import; rm -f "$S/source-unreachable"
expect_rc 4 'unreachable source'; evidence_is import fail:source
touch "$S/fail-pg-dump"; run import; rm -f "$S/fail-pg-dump" "$S/target-restored" "$S/target-sequences"
expect_rc 4 'pg_dump failure'; evidence_is import fail:dump; need "$tmp/out" 'reset the target before retrying'
touch "$S/fail-pg-restore"; run import; rm -f "$S/fail-pg-restore"
expect_rc 4 'pg_restore failure'; evidence_is import fail:restore; need "$tmp/out" 'it was rolled back'
[[ ! -e "$S/target-restored" ]] || fail 'a failed single-transaction restore left data behind'
# Both sides fail and the dump side's status is not 141 (SIGPIPE is ignored):
# the restore is still the cause.
touch "$S/fail-pg-restore" "$S/fail-pg-dump"; run import; rm -f "$S/fail-pg-restore" "$S/fail-pg-dump"
expect_rc 4 'pg_restore and pg_dump failure'; evidence_is import fail:restore
# With --extensions-created and every extension on the target, the import
# proceeds (here to a checksum mismatch).
echo 'citext,pgcrypto' > "$S/source-extensions"; echo 'citext,pgcrypto' > "$S/target-extensions"
touch "$S/restore-corrupt"; run import --extensions-created; rm -f "$S/restore-corrupt" "$S/target-restored" "$S/target-sequences" "$S/source-extensions" "$S/target-extensions"
expect_rc 4 'checksum mismatch'; evidence_is import fail:compare
need "$tmp/out" 'tables whose count or checksum differ: public.estate'
touch "$S/sequence-drift"; run import; rm -f "$S/sequence-drift" "$S/target-restored" "$S/target-sequences"
expect_rc 4 'sequence mismatch'; evidence_is import fail:compare
need "$tmp/out" 'sequences whose state differs: public.auth_user_id_seq,public.estate_id_seq'
[[ "$(< "$S/psql-timeout")" == $((2 * 120 + 120)) ]] || fail "the snapshot session timeout does not cover the count pass and the dump: $(< "$S/psql-timeout")"
# A termination while the source is counted records the interruption and
# removes the source container.
touch "$S/hang-count"; rm -f "$S/count-started" "$S/reaped"
set +e
env "${base_env[@]}" bash "$rehearse" import < /dev/null > "$tmp/out" 2>&1 &
pid=$!
for _ in $(seq 1 300); do [[ -e "$S/count-started" ]] && break; sleep 0.1; done
sleep 1; kill -TERM "$pid"; wait "$pid"; rc=$?
set -e
rm -f "$S/hang-count"
expect_rc 143 'terminated import'; evidence_is import fail:interrupted
[[ "$(cat "$S/reaped" 2>/dev/null)" == feedface0001 ]] || fail 'a terminated import did not remove its source container'
sleep 8
no_secrets 'failed imports'

# --- import --freeze-marked (production) ---------------------------------------
now_real="$("$real_date" -u +%s)"
echo $((now_real - 1801)) > "$S/clock-fixed"; run mark freeze-start; rm -f "$S/clock-fixed"
run import --freeze-marked
expect_rc 2 'stale operator freeze mark'; need "$tmp/out" 'not from the last 1800s'
run mark freeze-start; expect_rc 0 'operator freeze mark'; need "$tmp/out" 'replacing the earlier freeze-start mark'
operator_mark="$(field "$state/rehearsal/mark-freeze-start" epoch)"
sleep 1
run import --freeze-marked
expect_rc 0 'import --freeze-marked'; evidence_is import pass
[[ "$(field "$state/rehearsal/import" freeze_start)" == operator ]] || fail 'the evidence does not record freeze_start=operator'
[[ "$(field "$state/rehearsal/mark-freeze-start" epoch)" == "$operator_mark" ]] || fail '--freeze-marked replaced the operator mark'
rm -f "$S/target-restored" "$S/target-sequences"
run import --freeze-marked
expect_rc 2 'freeze mark older than the last import'; need "$tmp/out" 'older than the last import'

# --- import ok ----------------------------------------------------------------
rm -f "$state/rehearsal/mark-freeze-start" "$S/analyzed"
touch "$S/scan-argv"; run import; rm -f "$S/scan-argv"
expect_rc 0 'import'
evidence_is import pass
[[ -e "$S/analyzed" ]] || fail 'the import did not ANALYZE the target'
for key in count_seconds dump_seconds restore_seconds compare_seconds analyze_seconds total_seconds; do
  [[ "$(field "$state/rehearsal/import" "$key")" =~ ^[0-9]+$ ]] || fail "import evidence lacks $key"
done
[[ "$(field "$state/rehearsal/import" tables)" == 3 && "$(field "$state/rehearsal/import" source_pg_major)" == 17 ]] || fail 'import evidence lacks tables or the source major'
[[ "$(field "$state/rehearsal/mark-freeze-start" epoch)" == "$(field "$state/rehearsal/import" started_epoch)" ]] || fail 'the import did not simulate freeze-start at its start'
[[ "$(field "$state/rehearsal/import" freeze_start)" == import-start ]] || fail 'the evidence does not say freeze-start came from the import'
[[ "$(< "$S/dump-args")" == 'pg_dump -Fc --no-owner --no-acl --schema=public --snapshot=00000003-0000001B-1' ]] || fail "unexpected pg_dump arguments: $(< "$S/dump-args")"
[[ "$(< "$S/dump-txn")" == open ]] || fail 'pg_dump did not run inside the open snapshot transaction'
[[ "$(< "$S/source-txn")" == committed ]] || fail 'the source snapshot transaction was not committed'
[[ "$(< "$S/restore-args")" == '--exit-on-error --single-transaction --no-owner --no-acl --schema=public -U mawareeth -d mawareeth' ]] || fail "unexpected pg_restore arguments: $(< "$S/restore-args")"
[[ -e "$S/source-env-ok" ]] || fail 'the source never received its credentials through --env-file'
grep -Eq "^docker run --rm -i --name mawareeth-rehearsal-[0-9]{8}T[0-9]{6}Z-[0-9]+-psql .*--env-file $etc/heroku-source.env -e PGSSLMODE=require " "$S/calls.log" \
  || fail 'the source session is not a named, labelled --env-file container'
[[ -s "$S/argv-scanned" && "$(< "$S/argv-scanned")" -gt 0 ]] || fail 'the process argv scan did not run during the import'
[[ "$(< "$S/argv-leaks")" == 0 ]] || fail 'a process argv held the source password or a URL during the import'
no_secrets 'import'
run import
expect_rc 2 'import over imported data'; need "$tmp/out" 'never restores over existing data'

# --- capacity -----------------------------------------------------------------
gen_samples 30 50 30; load_summary 1000 0; load_input="$S/load"
run capacity
expect_rc 2 'green has no slot record'; need "$tmp/out" 'app-green has no slot record'
slot_record "$img_green" "$snap_green" > "$state/slots/green.env"; chmod 600 "$state/slots/green.env"
run capacity
expect_rc 2 'active slot not running'; need "$tmp/out" 'the active app-blue is not running'
touch "$S/running-app-blue" "$S/running-app-green"; run capacity; rm -f "$S/running-app-green"
expect_rc 2 'green already running'; need "$tmp/out" 'already running'
[[ ! -e "$S/stops" ]] || fail 'capacity stopped a slot it did not start'
touch "$S/lock-held-9"; run capacity; rm -f "$S/lock-held-9"
expect_rc 3 'capacity with the deploy lock held'
touch "$S/lock-held-8"; run capacity; rm -f "$S/lock-held-8"
expect_rc 3 'capacity with the backup lock held'
[[ ! -e "$S/stops" && ! -e "$S/running-app-green" ]] || fail 'capacity started a slot while a lock was held'

capacity_case() { # SIGNAL CPU MEM [SWAP] [OOM]
  rm -f "$S/stops"; gen_samples "$2" "$3" 30 "${4:-0}" "${5:-0}"
  run capacity
  expect_rc 4 "capacity $1"; evidence_is capacity "fail:$1"
  [[ ! -e "$S/running-app-green" && "$(cat "$S/stops")" == app-green ]] || fail "capacity $1 left app-green running"
  route_unchanged "capacity $1"
}
capacity_case cpu 70.1 50
capacity_case memory 20 80.1
capacity_case swap 20 50 1
capacity_case oom 20 50 0 1
gen_samples 30 50 14; rm -f "$S/stops"; run capacity
expect_rc 4 'short capacity run'; evidence_is capacity fail:insufficient-samples
gen_samples 30 50 30; load_summary 1000 11; rm -f "$S/stops"; run capacity
expect_rc 4 'load errors over 1%'; evidence_is capacity fail:load-errors
[[ "$(cat "$S/stops")" == app-green ]] || fail 'load errors left app-green running'
load_summary 1000 10; run capacity
expect_rc 0 'load errors at exactly 1%'
load_input=/dev/null; rm -f "$S/stops"; run capacity; load_input="$S/load"
expect_rc 4 'no load summary'; evidence_is capacity fail:load
[[ "$(cat "$S/stops")" == app-green ]] || fail 'a missing load summary left app-green running'
# The load must cover the sampling window.
load_summary 1000 0 1700; rm -f "$S/stops"; run capacity
expect_rc 4 'load shorter than the samples'; evidence_is capacity fail:load; need "$tmp/out" 'the load ran 1700s but the samples span 1800s'
[[ "$(cat "$S/stops")" == app-green ]] || fail 'a short load left app-green running'
load_summary 1000 0 1920 1000010 1001930; run capacity
expect_rc 4 'load started after the first sample'; evidence_is capacity fail:load; need "$tmp/out" 'does not cover the samples'
load_summary 1000 0 1920 999940 1001790; run capacity
expect_rc 4 'load finished before the last sample'; evidence_is capacity fail:load
load_summary 1000 0 1785 1000000 1001800; run capacity
expect_rc 0 'load exactly covering the samples, one interval short in seconds'
printf 'result=pass\nrequests=1000\nerrors=0\n' > "$S/load"; run capacity
expect_rc 4 'load summary without its window'; evidence_is capacity fail:load
load_summary 1000 0
touch "$S/fail-compose-up"; rm -f "$S/stops"; run capacity; rm -f "$S/fail-compose-up"
expect_rc 4 'slot start failure'; evidence_is capacity fail:start
[[ "$(cat "$S/stops")" == app-green ]] || fail 'a failed start left app-green running'
touch "$S/fail-compose-stop"; run capacity; rm -f "$S/fail-compose-stop" "$S/running-app-green"
expect_rc 4 'slot stop failure'; evidence_is capacity fail:stop; need "$tmp/out" 'CRITICAL: could not stop app-green'

# A termination while sampling stops the slot and records the interruption.
touch "$S/sampler-hang"; rm -f "$S/stops" "$S/sampler-started"
set +e
env "${base_env[@]}" bash "$rehearse" capacity < "$S/load" > "$tmp/out" 2>&1 &
pid=$!
for _ in $(seq 1 300); do [[ -e "$S/sampler-started" ]] && break; sleep 0.1; done
sleep 1; kill -TERM "$pid"; wait "$pid"; rc=$?
set -e
rm -f "$S/sampler-hang"
expect_rc 143 'terminated capacity run'; evidence_is capacity fail:interrupted
[[ ! -e "$S/running-app-green" && "$(cat "$S/stops")" == app-green ]] || fail 'a terminated capacity run left app-green running'
# A hangup (a dropped SSH session) does the same with 129.
touch "$S/sampler-hang"; rm -f "$S/stops" "$S/sampler-started"
set +e
env "${base_env[@]}" bash "$rehearse" capacity < "$S/load" > "$tmp/out" 2>&1 &
pid=$!
for _ in $(seq 1 300); do [[ -e "$S/sampler-started" ]] && break; sleep 0.1; done
sleep 1; kill -HUP "$pid"; wait "$pid"; rc=$?
set -e
rm -f "$S/sampler-hang"
expect_rc 129 'hung-up capacity run'; evidence_is capacity fail:interrupted
[[ ! -e "$S/running-app-green" && "$(cat "$S/stops")" == app-green ]] || fail 'a hung-up capacity run left app-green running'

gen_samples 30 50 30; load_summary 1000 0; rm -f "$S/stops"
run capacity --minutes 30
expect_rc 0 'capacity'
evidence_is capacity pass
[[ "$(cat "$S/stops")" == app-green && ! -e "$S/running-app-green" ]] || fail 'capacity did not stop app-green'
need "$S/compose-env" "APP_SNAPSHOT=$state/$snap_green"
need "$S/compose-env" "APP_GREEN_IMAGE=$img_green"
need "$S/compose-env" "APP_BLUE_IMAGE=$img_blue"
grep -Eq '^docker compose .* up -d --no-build --pull never --no-deps --wait --wait-timeout 30 app-green$' "$S/calls.log" || fail 'capacity did not start only app-green'
! grep -Eq '^docker compose .* (up|stop|restart|down).* app-blue$|^docker compose .*caddy' "$S/calls.log" || fail 'capacity touched the active slot or Caddy'
route_unchanged capacity
for key in peak_cpu_window_percent peak_memory_window_percent swap_in_delta oom_kill_delta load_requests load_errors load_tail_latency_ms \
  load_seconds load_started_epoch load_finished_epoch first_epoch last_epoch; do
  [[ -n "$(field "$state/rehearsal/capacity" "$key")" ]] || fail "capacity evidence lacks $key"
done
[[ "$(field "$state/rehearsal/capacity" duration_seconds)" == 1800 ]] || fail 'capacity evidence lacks the measured duration'
[[ "$(field "$state/rehearsal/capacity" peak_cpu_window_percent)" == 30.00 ]] || fail 'capacity evidence has the wrong CPU peak'
[[ -s "$state/rehearsal/capacity-samples.tsv" ]] || fail 'the samples were not kept'

# --- report -------------------------------------------------------------------
now="$("$real_date" -u +%s)"
write_restore() { # VERIFIED_EPOCH [RESULT]
  mkdir -p "$state/backup"; chmod 700 "$state/backup"
  printf 'result=%s\nverified_at=x\nverified_epoch=%s\ndump_age_seconds=3600\nduration_seconds=900\nrestore_seconds=700\nrpo_seconds=86400\nrto_seconds=14400\n' \
    "${2:-pass}" "$1" > "$state/backup/restore-verified"
  chmod 600 "$state/backup/restore-verified"
}
write_restore "$now"
freeze="$(field "$state/rehearsal/mark-freeze-start" epoch)"
mark_at() { echo "$2" > "$S/clock-fixed"; run mark "$1"; rm -f "$S/clock-fixed"; expect_rc 0 "mark $1"; }
# Reports run after every mark: at freeze-start plus 4000 seconds.
report_at() { echo $((freeze + 4000)) > "$S/clock-fixed"; run report; rm -f "$S/clock-fixed"; }
mark_at ttl-lowered $((freeze - 3600))
mark_at validated $((freeze + 900))
mark_at dns-switched $((freeze + 1500))
mark_at rollback-point $((freeze + 1850))
mark_at dns-rolled-back $((freeze + 1900))
need "$tmp/out" 'recorded dns-rolled-back at'
report_at
expect_rc 0 'report on a complete rehearsal'
report="$state/rehearsal/report"
for line in import_result=pass capacity_result=pass restore_result=pass path=write-freeze gate=pass unmet_items=0 \
  phase_freeze_to_validated_seconds=900 phase_freeze_to_dns_seconds=1500 phase_dns_rollback_seconds=400 phase_ttl_lead_seconds=3600; do
  grep -qx -- "$line" "$report" || fail "report lacks $line"
  need "$tmp/out" "$line"
done
for key in import_dump_seconds import_restore_seconds import_compare_seconds capacity_peak_cpu_window_percent restore_duration_seconds mark_validated; do
  [[ -n "$(field "$report" "$key")" ]] || fail "report lacks $key"
done
need "$tmp/out" 'gate passed: the cutover can use the write-freeze path'

mark_at validated $((freeze + 1201))
report_at
expect_rc 1 'freeze over 20 minutes'
grep -qx 'path=replication' "$report" || fail 'a slow freeze did not choose the replication path'
need "$tmp/out" 'needs the replication path'
mark_at validated $((freeze + 1200))
mark_at dns-switched $((freeze + 1801))
report_at
expect_rc 1 'DNS over 30 minutes'; grep -qx 'path=replication' "$report" || fail 'a slow DNS switch did not choose the replication path'
mark_at dns-switched $((freeze + 1800))
report_at
expect_rc 0 'freeze at exactly 20 and DNS at 30 minutes'; grep -qx 'path=write-freeze' "$report" || fail 'the budgets must be inclusive'

write_restore $((now - 36 * 86400)); report_at
expect_rc 1 'stale restore evidence'; need "$tmp/out" 'old (limit 35 days)'
write_restore "$now" fail:count-mismatch; report_at
expect_rc 1 'failed restore evidence'; need "$tmp/out" 'restore verification result is fail:count-mismatch'
write_restore "$now"; sed -i 's/^dump_age_seconds=.*/dump_age_seconds=86401/; s/^duration_seconds=.*/duration_seconds=14401/' "$state/backup/restore-verified"; report_at
expect_rc 1 'restore over the RPO and RTO'
need "$tmp/out" 'the restore evidence dump_age_seconds is 86401 (limit 86400)'
need "$tmp/out" 'the restore evidence duration_seconds is 14401 (limit 14400)'
write_restore "$now"
mark_at dns-rolled-back $((freeze + 1000))
report_at
expect_rc 1 'marks out of order'; need "$tmp/out" 'the dns-switched mark is later than the dns-rolled-back mark'
mark_at dns-rolled-back $((freeze + 1900))
rm -f "$state/rehearsal/mark-ttl-lowered"
report_at
expect_rc 1 'missing mark'; need "$tmp/out" 'the ttl-lowered mark is missing'
mark_at ttl-lowered $((freeze - 60))
report_at; expect_rc 0 'report restored'

# More mark-order and validity rules.
mark_at rollback-point $((freeze + 1100)); report_at
expect_rc 1 'rollback-point before validated'; need "$tmp/out" 'the validated mark is later than the rollback-point mark'
mark_at rollback-point $((freeze + 1500)); report_at
expect_rc 1 'rollback-point before dns-switched'; need "$tmp/out" 'the dns-switched mark is later than the rollback-point mark'
mark_at rollback-point $((freeze + 1950)); report_at
expect_rc 1 'rollback-point after dns-rolled-back'; need "$tmp/out" 'the rollback-point mark is later than the dns-rolled-back mark'
mark_at rollback-point $((freeze + 1850))
mark_at ttl-lowered $((freeze + 10)); report_at
expect_rc 1 'ttl-lowered after freeze-start'; need "$tmp/out" 'the ttl-lowered mark is later than the freeze-start mark'
mark_at ttl-lowered $((freeze + 10000)); report_at
expect_rc 1 'future-dated mark'; need "$tmp/out" 'the ttl-lowered mark is missing or invalid'
mark_at ttl-lowered $((freeze - 60))
report_at; expect_rc 0 'report restored after the mark checks'

# Evidence coherence: capacity and the restore proof must follow the import.
import_done="$(field "$state/rehearsal/import" finished_epoch)"
write_restore $((import_done - 10)); report_at
expect_rc 1 'restore verified before the import'; need "$tmp/out" 'the restore was verified before the import finished'
write_restore "$now"
cp "$state/rehearsal/capacity" "$tmp/capacity.good"
sed -i "s/^started_epoch=.*/started_epoch=$((import_done - 10))/" "$state/rehearsal/capacity"; report_at
expect_rc 1 'capacity before the import'; need "$tmp/out" 'the capacity run did not start after the import finished'
cp "$tmp/capacity.good" "$state/rehearsal/capacity"
sed -i 's/^duration_seconds=.*/duration_seconds=1799/; s/^minutes=.*/minutes=30/' "$state/rehearsal/capacity"; report_at
expect_rc 1 'passing capacity under 30 measured minutes'; need "$tmp/out" 'the passing capacity run measured 1799 seconds of samples; at least 1800 are required'
cp "$tmp/capacity.good" "$state/rehearsal/capacity"
printf 'result=fail:cpu\nminutes=30\n' > "$state/rehearsal/capacity"; chmod 600 "$state/rehearsal/capacity"
report_at
expect_rc 1 'failed capacity evidence'; need "$tmp/out" 'the capacity result is fail:cpu, not pass'
no_secrets 'report'

printf 'deploy/rehearse.sh tests passed\n'
