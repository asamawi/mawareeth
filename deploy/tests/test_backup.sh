#!/usr/bin/env bash
# shellcheck disable=SC2016 # literal $ patterns are intentional in assertions.
# Offline tests for deploy/backup.sh. Docker (and through it Restic, psql,
# pg_dump, pg_restore), systemctl, date, df, and (when absent) flock are
# stubbed; nothing touches the network, a registry, a Storage Box, host Docker
# state, systemd, or this checkout.
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
fail() { printf 'FAIL: %s\n' "$*" >&2; [[ ! -f "${tmp:-}/out" ]] || sed 's/^/  | /' "$tmp/out" >&2; exit 1; }
need() { grep -Fq -- "$2" "$1" || fail "missing $2 in $1"; }

backup_src="$root/deploy/backup.sh"
bash -n "$backup_src" "$root/deploy/runtime.sh" "$0"
! grep -Eq '\|\|[[:space:]]*(true|:)([[:space:]]|$|;)' "$backup_src" || fail 'backup.sh must not mask failures with || true'
! grep -Eq 'acquire_deploy_lock|deploy_lock_file|journal_file|write_snapshot|ensure_state_subdirs|seed_route|load_slot_images' "$backup_src" \
  || fail 'backup.sh must not take the deploy lock or write slots, routes, the journal, or snapshots'
# Slots and routes are only read, for the host-state archive: no line naming
# them may redirect into, move, remove, or change anything.
! grep -E 'slots_dir|routes_dir|route_file' "$backup_src" | grep -Eq '(^|[^0-9&>])>|\<(rm|mv|cp|ln|install|mkdir|chmod|chown|touch|state_subdir|atomic_write)\>' \
  || fail 'backup.sh may only read slots and routes'
grep -Eq '^RESTIC_IMAGE=docker\.io/restic/restic:0\.18\.[0-9]+@sha256:[0-9a-f]{64}$' "$root/deploy/runtime-images.lock" || fail 'Restic is not pinned by digest in the image lock'
[[ "$(cat "$root/deploy/backup.env.example")" == $'STORAGE_BOX_USER=u123456-sub1\nSTORAGE_BOX_HOST=u123456.your-storagebox.de\nRESTIC_REPOSITORY_PATH=mawareeth-restic' ]] \
  || fail 'backup.env.example must contain exactly the three raw keys'

real_stat="$(command -v stat)"; real_install="$(command -v install)"; real_date="$(command -v date)"
real_flock="$(command -v flock 2>/dev/null || true)"; real_sync="$(command -v sync)"; real_tar="$(command -v tar)"

tmp="$(mktemp -d)"; [[ -z "${KEEP_TMP:-}" ]] || echo "$tmp" >&2
case "$tmp" in "$root"/*) fail 'temporary directory must be outside the checkout' ;; esac
trap '[[ -n "${KEEP_TMP:-}" ]] || rm -rf "$tmp"' EXIT
stub="$tmp/bin"; S="$tmp/docker-state"; state="$tmp/state"; bundle="$tmp/bundle"; etc="$tmp/etc"; units="$tmp/systemd"
mkdir -p "$stub" "$S/docker-root" "$state" "$bundle/deploy" "$etc" "$units"
# Root-only like the state directory runtime.sh prepare creates (checked for real as root).
chmod 700 "$state"

# A disposable bundle; only the root execution gate is relaxed when unprivileged.
cp "$root/deploy/runtime-images.lock" "$bundle/deploy/"
for script in runtime.sh backup.sh; do
  if [[ ${EUID:-999} -ne 0 ]]; then
    sed 's/\[\[ ${EUID:-999} -eq 0 \]\]/[[ 0 -eq 0 ]]/' "$root/deploy/$script" > "$bundle/deploy/$script"
    ! grep -Fq 'EUID' "$bundle/deploy/$script" || fail "root-gate patch was not applied to $script"
  else
    cp "$root/deploy/$script" "$bundle/deploy/$script"
  fi
done
backup="$bundle/deploy/backup.sh"; lock="$bundle/deploy/runtime-images.lock"
cp "$lock" "$tmp/lock.good"

cp "$root/deploy/backup.env.example" "$etc/backup.env"
printf 'restic-repository-password-NEVER-PRINT\n' > "$etc/restic.password"
printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\nstub-key-material-NEVER-PRINT\n-----END OPENSSH PRIVATE KEY-----\n' > "$etc/storagebox_ed25519"
printf '[u123456.your-storagebox.de]:23 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStubHostKey\n' > "$etc/storagebox_known_hosts"
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
chmod 600 "$etc"/*

# Host state the nightly run archives: a route, blue.env and blue.env.prev
# naming the same snapshot (listed once), green.env.prev naming another, an
# unreferenced snapshot and a stray slots/.tmp.abc (neither archived).
snap_a="$(printf 'a%.0s' {1..64}).snapshot.env"; snap_b="$(printf 'b%.0s' {1..64}).snapshot.env"
mkdir -p "$state/routes" "$state/slots"; chmod 755 "$state/routes"; chmod 700 "$state/slots"
printf 'reverse_proxy app-blue:8000\n' > "$state/routes/active-slot.caddy"; chmod 644 "$state/routes/active-slot.caddy"
slot_record() { printf 'IMAGE=ghcr.io/example/mawareeth@sha256:%s\nCOMMIT=%s\nSNAPSHOT=%s\n' "$(printf 'c%.0s' {1..64})" "$(printf 'd%.0s' {1..40})" "$1"; }
slot_record "$snap_a" > "$state/slots/blue.env"; slot_record "$snap_a" > "$state/slots/blue.env.prev"
slot_record "$snap_b" > "$state/slots/green.env.prev"; printf 'half-written\n' > "$state/slots/.tmp.abc"
printf 'SNAPSHOT_A=1\n' > "$state/$snap_a"; printf 'SNAPSHOT_B=1\n' > "$state/$snap_b"
printf 'UNREFERENCED=1\n' > "$state/$(printf 'e%.0s' {1..64}).snapshot.env"
chmod 600 "$state/slots"/* "$state/slots/.tmp.abc" "$state"/*.snapshot.env
rel_state="${state#/}"
host_state_base="$(printf '%s\n' "${etc#/}/runtime.env" "$rel_state/routes/" "$rel_state/routes/active-slot.caddy")"
expected_host_state="$(printf '%s\n' "$host_state_base" "$rel_state/slots/" "$rel_state/slots/blue.env" "$rel_state/slots/blue.env.prev" \
  "$rel_state/slots/green.env.prev" "$rel_state/$snap_a" "$rel_state/$snap_b" | LC_ALL=C sort)"
# listing_of RUN: the sorted member list of that run's host-state archive.
listing_of() { local d; d="$(snap_dir_of "run:$1" /host-state.tar)"; [[ -n "$d" ]] || return 1; tar -tf "$d/data" | LC_ALL=C sort; }
# Can this filesystem hold a real symlink? (Not on some Windows setups.)
ln -s "$tmp/probe-target" "$tmp/symlink-probe" 2>/dev/null || :
symlinks_work=0; [[ ! -L "$tmp/symlink-probe" ]] || symlinks_work=1

# The production database as "<key><TAB>count<TAB>checksum" rows.
good_counts=$'public.auth_user\t3\t-4611686018427387904\npublic.django_migrations\t42\t8070450532247928832\npublic.estate\t7\t123456789'
printf '%s\n' "$good_counts" > "$S/db-counts"
# The output settings both psql sessions must apply before the checksum query.
printf '%s\n' "SET TimeZone = 'UTC';" "SET DateStyle = 'ISO, YMD';" "SET IntervalStyle = 'postgres';" \
  "SET extra_float_digits = 1;" "SET bytea_output = 'hex';" "SET lc_monetary = 'C';" > "$S/expected-settings"
touch "$S/running-postgres"

# Restic stub: a file-backed repository under $S/repo. Like real Restic,
# `tag` rewrites a snapshot under a new ID. Markers in $S inject failures.
cat > "$stub/restic-sim" <<'EOF'
#!/usr/bin/env bash
S='__S__'; repo="$S/repo"
printf 'restic %s\n' "$*" >> "$S/restic.log"
[[ "${RESTIC_REPOSITORY:-}" == 'sftp:u123456-sub1@u123456.your-storagebox.de:mawareeth-restic' ]] || { echo 'unexpected repository' >&2; exit 9; }
[[ "${RESTIC_PASSWORD_FILE:-}" == /run/mawareeth/restic.password && "${RESTIC_CACHE_DIR:-}" == /cache ]] || { echo 'unexpected restic environment' >&2; exit 9; }
[[ "$1" == -o && "$2" == 'sftp.command=ssh -p 23 -i /run/mawareeth/storagebox_ed25519 -o UserKnownHostsFile=/run/mawareeth/known_hosts -o StrictHostKeyChecking=yes '*' u123456-sub1@u123456.your-storagebox.de -s sftp' ]] \
  || { echo 'unexpected sftp command' >&2; exit 9; }
if [[ -e "$S/repo-unreachable" ]]; then echo 'Host key verification failed. LEAKY-SSH-DETAIL' >&2; exit 1; fi
shift 2
all="$*"; cmd="$1"; shift
[[ "$cmd" == init || -d "$repo" ]] || { echo 'Fatal: repository does not exist' >&2; exit 1; }
if [[ "$cmd" == unlock && -e "$S/hang-restic" ]]; then rm -f "$S/hang-restic"; sleep 4; fi
tag=''; host=''; fname=''; add=''; remove=''; keep=0; pos=()
while (($#)); do
  case "$1" in
    --tag) tag="$2"; shift 2 ;; --host) host="$2"; shift 2 ;; --stdin-filename) fname="$2"; shift 2 ;;
    --add) add="$2"; shift 2 ;; --remove) remove="$2"; shift 2 ;; --keep-*) keep=1; shift 2 ;; --mode) shift 2 ;;
    --*) shift ;; *) pos+=("$1"); shift ;;
  esac
done
matches() {
  local d="$1" t
  [[ -z "$host" || "$(< "$d/host")" == "$host" ]] || return 1
  [[ -z "$tag" ]] && return 0
  for t in ${tag//,/ }; do grep -qx -- "$t" "$d/tags" || return 1; done
}
next_id() { local n; n=$(( $(cat "$repo/counter" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$repo/counter"; printf '%064x\n' "$n"; }
case "$cmd" in
  init) [[ ! -d "$repo" ]] || { echo 'config file already exists' >&2; exit 1; }; mkdir -p "$repo/snaps"; echo 'created restic repository' ;;
  unlock) ;;
  check) [[ ! -e "$S/fail-check" ]] || { echo 'Fatal: repository contains errors' >&2; exit 1; } ;;
  snapshots)
    sep=''; printf '['
    for d in "$repo"/snaps/*/; do
      [[ -d "$d" ]] || continue; d="${d%/}"; matches "$d" || continue
      tags="$(sed 's/.*/"&"/' "$d/tags" | paste -sd, -)"
      printf '%s{"id":"%s","time":"%s","paths":["%s"],"tags":[%s],"hostname":"%s"}' "$sep" "${d##*/}" "$(< "$d/time")" "$(< "$d/path")" "$tags" "$(< "$d/host")"
      sep=','
    done
    printf ']\n' ;;
  backup)
    if [[ -e "$S/fail-restic-backup" || -e "$S/fail-restic-backup-$fname" ]]; then cat > /dev/null; exit 1; fi
    d="$repo/snaps/$(next_id)"; mkdir -p "$d"
    cat > "$d/data"; printf '/%s\n' "$fname" > "$d/path"; tr ',' '\n' <<<"$tag" > "$d/tags"
    printf '%s\n' "$host" > "$d/host"; date -u +%Y-%m-%dT%H:%M:%S.123456789Z > "$d/time" ;;
  dump)
    d="$repo/snaps/${pos[0]}"; [[ -d "$d" && "$(< "$d/path")" == "${pos[1]}" ]] || { echo 'no such file' >&2; exit 1; }
    cat "$d/data" ;;
  stats)
    d="$repo/snaps/${pos[0]}"; [[ -d "$d" ]] || exit 1
    size="$(wc -c < "$d/data" | tr -d ' ')"; [[ ! -e "$S/dump-size" ]] || size="$(< "$S/dump-size")"
    printf '{"total_size":%s,"total_file_count":1,"snapshots_count":1}\n' "$size" ;;
  tag)
    count=0
    for id in "${pos[@]}"; do
      if [[ -e "$S/fail-tag-partial" ]] && ((count == 1)); then echo 'Fatal: connection lost' >&2; exit 1; fi
      d="$repo/snaps/$id"; [[ -d "$d" ]] || exit 1
      grep -vx -- "$remove" "$d/tags" > "$d/tags.new" || :; printf '%s\n' "$add" >> "$d/tags.new"; mv "$d/tags.new" "$d/tags"
      mv "$d" "$repo/snaps/$(next_id)"; count=$((count + 1))
    done ;;
  forget)
    if ((keep)); then
      [[ ! -e "$S/fail-retention" ]] || { echo 'Fatal: prune failed' >&2; exit 1; }
      printf '%s\n' "$all" >> "$S/retention"
    else for id in "${pos[@]}"; do rm -rf "${repo:?}/snaps/$id"; done; fi ;;
  *) exit 1 ;;
esac
EOF

# Docker stub: production PostgreSQL (container abcdef123456, version 17)
# answers a psql coprocess, pg_dump, and pg_dumpall from $S/db-counts; restore
# containers keep restored counts and checksums in $S/restored-<name>. Both
# psql sessions refuse the checksum query unless the output settings in
# $S/expected-settings arrived first. Containers are marker files
# $S/container-<name> holding their state. Markers in $S inject failures.
cat > "$stub/docker" <<'EOF'
#!/usr/bin/env bash
S='__S__'
printf 'docker %s\n' "$*" >> "$S/calls.log"
prod=abcdef123456
filter_name() { local f="${*: -1}"; f="${f#name=^}"; printf '%s\n' "${f%$}"; }
case "${1:-} ${2:-}" in
  'image inspect')
    if [[ "$*" == *RepoDigests* ]]; then
      printf '%s\n' 'docker.io/library/postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3' \
        'docker.io/restic/restic@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76'
    else printf 'sha256:%064d\n' 1; fi
    exit 0 ;;
  'info --format') printf '%s\n' "$S/docker-root"; exit 0 ;;
  'ps --filter')
    [[ "$*" == *com.docker.compose.project=mawareeth* && "$*" == *com.docker.compose.service=postgres* ]] || exit 1
    [[ ! -e "$S/running-postgres" ]] || printf '%s\n' "$prod"
    [[ ! -e "$S/two-postgres" ]] || printf 'fedcba654321\n'
    exit 0 ;;
  'ps -a')
    if [[ "$*" == *label=com.mawareeth.role=restic* ]]; then
      for m in "$S"/container-mawareeth-restic-*; do [[ -e "$m" ]] && printf '%s %s\n' "${m##*/container-}" "$(< "$m")"; done
    elif [[ "$*" == *label=com.mawareeth.backup-run=* ]]; then
      token="${*##*backup-run=}"
      for m in "$S"/container-mawareeth-restic-"$token"-*; do [[ -e "$m" ]] && printf '%s\n' "${m##*/container-}"; done
    else
      name="$(filter_name "$@")"; [[ ! -e "$S/container-$name" ]] || printf 'c0ffee\n'
    fi
    exit 0 ;;
  'volume ls')
    name="$(filter_name "$@")"
    [[ ! -e "$S/fail-volume-ls-restore" || "$name" != mawareeth-restore-* ]] || exit 1
    [[ ! -e "$S/volume-$name" ]] || printf '%s\n' "$name"; exit 0 ;;
  'volume inspect')
    name="${*: -1}"; [[ -e "$S/volume-$name" ]] || exit 1
    case "$name" in mawareeth-restic-cache) printf 'mawareeth restic-cache\n' ;; *) printf 'mawareeth restore-check\n' ;; esac
    exit 0 ;;
  'volume create') touch "$S/volume-${*: -1}"; printf '%s\n' "${*: -1}"; exit 0 ;;
  'volume rm')
    [[ ! -e "$S/fail-volume-rm" ]] || exit 1
    [[ -e "$S/volume-${*: -1}" ]] || exit 1; rm -f "$S/volume-${*: -1}"; exit 0 ;;
  'rm -f')
    name="${*: -1}"
    [[ ! -e "$S/fail-rm-restore" || "$name" != mawareeth-restore-* ]] || exit 1
    rm -f "$S/container-$name"; exit 0 ;;
  'run --rm')
    # Like Docker: "-e KEY=VALUE" sets a value, "-e KEY" passes the caller's.
    args=("$@"); container_env=(); name=''
    for i in "${!args[@]}"; do
      [[ "${args[$i]}" != --name ]] || name="${args[$((i + 1))]}"
      if [[ "${args[$i]}" == -e ]]; then
        entry="${args[$((i + 1))]}"
        if [[ "$entry" == *=* ]]; then container_env+=("$entry"); else container_env+=("$entry=${!entry:-}"); fi
      fi
      if [[ "${args[$i]}" == docker.io/restic/restic:* ]]; then
        [[ "$name" == mawareeth-restic-* ]] || exit 125
        echo running > "$S/container-$name"
        status=0
        env -i PATH="$PATH" "${container_env[@]}" "$S/../bin/restic-sim" "${args[@]:$((i + 1))}" || status=$?
        rm -f "$S/container-$name"
        exit "$status"
      fi
    done
    exit 1 ;;
  'run -d')
    printf '%s\n' "$*" > "$S/restore-run"
    [[ "${POSTGRES_PASSWORD:-}" =~ ^[0-9a-f]{48}$ ]] || exit 1
    args=("$@")
    for i in "${!args[@]}"; do [[ "${args[$i]}" != --name ]] || name="${args[$((i + 1))]}"; done
    echo running > "$S/container-$name"; printf 'c0ffee\n'; exit 0 ;;
esac
[[ "${1:-}" == exec ]] || exit 1
shift; [[ "$1" != -i ]] || shift
container="$1"; shift
in_container_timeout=0
if [[ "$1" == timeout ]]; then [[ "$2" =~ ^[0-9]+$ ]] || exit 1; in_container_timeout=1; shift 2; fi
program="$1"
if [[ "$container" == "$prod" ]]; then
  [[ -e "$S/running-postgres" ]] || exit 1
  case "$program" in
    psql)
      echo "$in_container_timeout" > "$S/psql-timeout"
      while IFS= read -r line; do
        case "$line" in
          'BEGIN ISOLATION LEVEL REPEATABLE READ;') echo open > "$S/txn"; : > "$S/prod-settings" ;;
          'SELECT pg_export_snapshot();') cp "$S/db-counts" "$S/pg-snapshot"; echo '00000003-0000001B-1' ;;
          'SHOW server_version_num;') if [[ -e "$S/bad-version" ]]; then echo '17.11'; else echo 170011; fi ;;
          'SET '*) printf '%s\n' "$line" >> "$S/prod-settings" ;;
          *'\gexec')
            [[ "$line" == *"!~ '^pg_(toast_)?temp_'"* && "$line" == *"format('%I.%I', schemaname, tablename)"* && "$line" == *'md5(t.*::text)'* ]] || exit 3
            cmp -s "$S/prod-settings" "$S/expected-settings" || { echo 'checksum query before the output settings' >&2; exit 3; }
            cat "$S/db-counts"
            # A write committed by another session after the counts were taken.
            if [[ -e "$S/concurrent-write" ]]; then sed -i 's/^public\.estate\t7\t123456789$/public.estate\t8\t987654321/' "$S/db-counts"; fi ;;
          "SELECT 'mawareeth-counts-end';") echo mawareeth-counts-end ;;
          'COMMIT;') echo committed > "$S/txn" ;;
          *) echo "unexpected SQL: $line" >&2; exit 3 ;;
        esac
      done
      exit 0 ;;
    pg_dump)
      cat "$S/txn" > "$S/dump-txn"; printf '%s %s\n' "$in_container_timeout" "$*" > "$S/dump-args"
      if [[ -e "$S/term-on-pg-dump" ]]; then rm -f "$S/term-on-pg-dump"; kill -TERM "$(< "$S/backup.pid")"; fi
      # runtime.env becomes a symlink after the configuration was validated.
      if [[ -e "$S/symlink-runtime-on-dump" ]]; then
        rm -f "$S/symlink-runtime-on-dump"; mv '__ETC__/runtime.env' '__ETC__/runtime.env.real'; ln -s '__ETC__/runtime.env.real' '__ETC__/runtime.env'
      fi
      printf 'PGDMP'
      if [[ -e "$S/fail-pg-dump" ]]; then head -n 1 "$S/db-counts"; echo 'pg_dump: error: connection lost' >&2; exit 1; fi
      if [[ "$*" == *--snapshot=00000003-0000001B-1* ]]; then cat "$S/pg-snapshot"; else cat "$S/db-counts"; fi
      exit 0 ;;
    pg_dumpall)
      printf '%s %s\n' "$in_container_timeout" "$*" > "$S/dumpall-args"
      if [[ -e "$S/fail-pg-dumpall" ]]; then printf -- '--\n'; echo 'pg_dumpall: error: connection lost' >&2; exit 1; fi
      [[ -e "$S/globals-no-header" ]] || printf -- '--\n-- PostgreSQL database cluster dump\n--\n\n'
      printf 'CREATE ROLE mawareeth;\nALTER ROLE mawareeth WITH SUPERUSER LOGIN PASSWORD %s;\n' "'SCRAM-SHA-256\$stub-role-hash-NEVER-PRINT'"
      exit 0 ;;
  esac
  exit 1
fi
[[ "$container" == mawareeth-restore-* && -e "$S/container-$container" ]] || exit 1
case "$program" in
  pg_isready) exit 0 ;;
  pg_restore)
    printf '%s %s\n' "$in_container_timeout" "$*" > "$S/restore-args"
    data="$(cat)"; [[ "$data" == PGDMP* ]] || exit 1
    printf '%s\n' "${data#PGDMP}" > "$S/restored-$container"
    [[ ! -e "$S/slow-restore" ]] || echo 20000 > "$S/clock-offset"
    if [[ -e "$S/term-on-restore" ]]; then rm -f "$S/term-on-restore"; kill -TERM "$(< "$S/backup.pid")"; fi
    [[ ! -e "$S/fail-pg-restore" ]] || exit 1
    exit 0 ;;
  psql)
    : > "$S/restore-settings"
    while IFS= read -r line; do
      case "$line" in
        'SHOW server_version_num;') if [[ -e "$S/restore-major" ]]; then echo 160004; elif [[ -e "$S/restore-bad-version" ]]; then echo 17.11; else echo 170011; fi ;;
        'SET '*) printf '%s\n' "$line" >> "$S/restore-settings" ;;
        *'\gexec')
          cmp -s "$S/restore-settings" "$S/expected-settings" || { echo 'checksum query before the output settings' >&2; exit 3; }
          out="$(cat "$S/restored-$container")"
          # The counts-only query of a legacy manifest returns two columns.
          if [[ "$line" == *'md5(t.*::text)'* ]]; then echo checksum > "$S/restore-sql-kind"
          else echo legacy > "$S/restore-sql-kind"; out="$(cut -f1,2 <<<"$out")"; fi
          if [[ -e "$S/restore-drop-row" ]]; then out="$(sed 's/^public\.estate\t[0-9]*/public.estate\t0/' <<<"$out")"; fi
          # One value differs while every count still matches.
          if [[ -e "$S/restore-corrupt-value" ]]; then out="$(sed 's/^\(public\.estate\t[0-9]*\)\t.*$/\1\t42/' <<<"$out")"; fi
          printf '%s\n' "$out" ;;
        *) exit 3 ;;
      esac
    done
    exit 0 ;;
esac
exit 1
EOF
cat > "$stub/systemctl" <<'EOF'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >> '__S__/systemctl.log'
EOF
# A controllable clock: "$S/clock-offset" seconds are added to `date +%s`.
cat > "$stub/date" <<'EOF'
#!/usr/bin/env bash
out="$('__DATE__' "$@")" || exit $?
if [[ "${*: -1}" == +%s && -e '__S__/clock-offset' ]]; then out=$((out + $(< '__S__/clock-offset'))); fi
# "$S/fixed-stamp" pins backup.sh's run stamp so two runs share one second.
if [[ "${*: -1}" == +%Y%m%dT%H%M%SZ && -e '__S__/fixed-stamp' ]]; then out="$(< '__S__/fixed-stamp')"; fi
printf '%s\n' "$out"
EOF
# Free space on the Docker data root: "$S/disk-avail" bytes, default 1 TB.
cat > "$stub/df" <<'EOF'
#!/usr/bin/env bash
[[ "$*" == "-B1 --output=avail __S__/docker-root" ]] || exit 1
printf 'Avail\n%s\n' "$(cat '__S__/disk-avail' 2>/dev/null || echo 1000000000000)"
EOF
# tar: "$S/fail-tar" makes archive creation write a few bytes, then fail.
cat > "$stub/tar" <<'EOF'
#!/usr/bin/env bash
if [[ -e '__S__/fail-tar' && " $* " == *' -cf - '* ]]; then printf 'partial-archive'; exit 2; fi
exec '__TAR__' "$@"
EOF
sed -i "s|__S__|$S|g; s|__DATE__|$real_date|g; s|__ETC__|$etc|g; s|__TAR__|$real_tar|g" "$stub/restic-sim" "$stub/docker" "$stub/systemctl" "$stub/date" "$stub/df" "$stub/tar"
! grep -Fq '__' "$stub/restic-sim" "$stub/docker" "$stub/systemctl" "$stub/date" "$stub/df" "$stub/tar" || fail 'stub placeholders were not substituted'
chmod +x "$stub/restic-sim" "$stub/docker" "$stub/systemctl" "$stub/date" "$stub/df" "$stub/tar"

if [[ -z "$real_flock" ]]; then
  printf '#!/usr/bin/env bash\n[[ ! -e %q ]]\n' "$S/lock-held" > "$stub/flock"
  chmod +x "$stub/flock"
fi
printf 'probe\n' > "$tmp/sync-probe"
if ! "$real_sync" -- "$tmp/sync-probe" 2>/dev/null; then
  printf '#!/usr/bin/env bash\nexit 0\n' > "$stub/sync"; chmod +x "$stub/sync"
fi
# Can this filesystem represent mode 0600? (Not on some Windows mounts.)
chmod 600 "$tmp/sync-probe"; modes_work=0
[[ "$("$real_stat" -c %a "$tmp/sync-probe")" != 600 ]] || modes_work=1
# Unprivileged runs report the ownership and modes root would establish;
# "$S/mode-<basename>" overrides one file.
if [[ ${EUID:-999} -ne 0 ]]; then
  cat > "$stub/stat" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == -c && "$2" == '%u:%g:%a' ]]; then
  if [[ -e "__S__/mode-${3##*/}" ]]; then cat "__S__/mode-${3##*/}"; exit 0; fi
  [[ -e "$3" ]] || exit 1
  case "$3" in
    *runtime-images.lock|*.service|*.timer) printf '0:0:644\n' ;;
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
  MAWAREETH_SYSTEMD_DIR="$units" MAWAREETH_BACKUP_START_TIMEOUT=5 MAWAREETH_BACKUP_POLL_INTERVAL=1 MAWAREETH_BACKUP_TIMEOUT=60 MAWAREETH_BACKUP_REPO_TIMEOUT=60)
rc=0
# run [ENV=VALUE...] COMMAND
run() {
  local pid
  : > "$S/calls.log"
  set +e
  env "${base_env[@]}" "${@:1:$#-1}" bash "$backup" "${@: -1}" > "$tmp/out" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" > "$S/backup.pid"
  wait "$pid"
  rc=$?
  set -e
}
expect_rc() { [[ "$rc" == "$1" ]] || fail "$2: expected exit $1, got $rc"; }
field() { grep -E "^$2=" "$1" | head -n 1 | cut -d= -f2-; }
status_is() { [[ "$(field "$state/backup/last-backup" result)" == "$1" ]] || fail "backup status is $(field "$state/backup/last-backup" result), not $1"; }
evidence_is() { [[ "$(field "$state/backup/restore-verified" result)" == "$1" ]] || fail "restore evidence is $(field "$state/backup/restore-verified" result), not $1"; }
snaps_with() { local n=0 d; for d in "$S"/repo/snaps/*/; do [[ -d "$d" ]] && grep -qx -- "$1" "$d/tags" && n=$((n + 1)); done; printf '%s\n' "$n"; }
no_secrets() {
  ! grep -Eq 'NEVER-PRINT|LongUrlSafePassword_123456|a-long-django-key|LEAKY-SSH-DETAIL' "$tmp/out" "$S/calls.log" || fail "$1 leaked a secret or raw SSH diagnostics"
  ! grep -Eq 'POSTGRES_PASSWORD=' "$S/calls.log" || fail "$1 put a database password on a command line"
}
no_restore_leftovers() { [[ -z "$(find "$S" -maxdepth 1 \( -name 'container-mawareeth-restore-*' -o -name 'volume-mawareeth-restore-*' \) -print -quit)" ]] || fail "$1 left the restore container or volume behind"; }
no_restic_leftovers() { [[ -z "$(find "$S" -maxdepth 1 -name 'container-mawareeth-restic-*' -print -quit)" ]] || fail "$1 left a Restic container behind"; }
no_plain_dump() { ! grep -rlq PGDMP "$state" 2>/dev/null || fail "$1 wrote unencrypted dump bytes under the state directory"; }
docker_mutations() { grep -cE '^docker (run|volume create)' "$S/calls.log" || :; }
snap_dir_of() { local d; for d in "$S"/repo/snaps/*/; do grep -qx -- "$1" "$d/tags" && [[ "$(< "$d/path")" == "$2" ]] && printf '%s\n' "${d%/}"; done; return 0; }

# --- Gate with no evidence ----------------------------------------------------
run gate
expect_rc 1 'gate without evidence'
need "$tmp/out" 'no readable root-only restore evidence'
need "$tmp/out" 'no readable root-only backup status'

# --- Refusals before mutation ------------------------------------------------
if [[ ${EUID:-999} -eq 0 ]]; then chmod 644 "$etc/restic.password"; else printf '0:0:644\n' > "$S/mode-restic.password"; fi
run backup; rm -f "$S/mode-restic.password"; chmod 600 "$etc/restic.password"
expect_rc 2 'world-readable Restic password'
[[ "$(docker_mutations)" == 0 ]] || fail 'a refused backup ran Docker'
cp "$etc/backup.env" "$tmp/backup.env.good"
printf 'RESTIC_PASSWORD=inline\n' >> "$etc/backup.env"
run backup; cp "$tmp/backup.env.good" "$etc/backup.env"
expect_rc 2 'unsupported backup.env key'
need "$tmp/out" 'unsupported key: RESTIC_PASSWORD'

# The Restic pin: a wrong digest or tag is refused, a missing entry is refused
# by backup.sh, and a lock without it still loads for deploys.
sed 's/^RESTIC_IMAGE=.*/RESTIC_IMAGE=docker.io\/restic\/restic:0.18.1@sha256:0000000000000000000000000000000000000000000000000000000000000000/' "$tmp/lock.good" > "$lock"
run backup; expect_rc 2 'wrong Restic digest'; need "$tmp/out" 'outside the allowlist'
sed 's/^RESTIC_IMAGE=docker.io\/restic\/restic:0.18.1@/RESTIC_IMAGE=docker.io\/restic\/restic:latest@/' "$tmp/lock.good" > "$lock"
run backup; expect_rc 2 'wrong Restic tag'; need "$tmp/out" 'outside the allowlist'
grep -v '^RESTIC_IMAGE=' "$tmp/lock.good" > "$lock"
run backup; expect_rc 2 'missing Restic pin'; need "$tmp/out" 'no RESTIC_IMAGE entry'
[[ "$(docker_mutations)" == 0 ]] || fail 'a refused lock ran Docker'
env PATH="$stub:$PATH" MAWAREETH_RUNTIME_IMAGE_LOCK="$lock" bash -c 'source "$1"; load_lock; [[ -z "${locked[RESTIC_IMAGE]:-}" && -n "${locked[POSTGRES_IMAGE]}" ]]' _ "$bundle/deploy/runtime.sh" \
  || fail 'a lock without RESTIC_IMAGE no longer loads for deploys'
cp "$tmp/lock.good" "$lock"

# --- Repository missing, then init -------------------------------------------
run backup
expect_rc 5 'backup before init'
status_is failed:repository
no_secrets 'backup before init'
run init
expect_rc 0 'init'
[[ -d "$S/repo/snaps" && -e "$S/volume-mawareeth-restic-cache" ]] || fail 'init did not create the repository and cache volume'
run init
expect_rc 5 'second init'

# --- Nightly backup, with a concurrent write and a stale pending snapshot ------
mkdir -p "$S/repo/snaps/stale"; printf 'pending\nrun:19990101T000000Z\n' > "$S/repo/snaps/stale/tags"
printf '/mawareeth.dump\n' > "$S/repo/snaps/stale/path"; printf 'mawareeth\n' > "$S/repo/snaps/stale/host"
printf '1999-01-01T00:00:00Z\n' > "$S/repo/snaps/stale/time"; printf 'PGDMPstale\n' > "$S/repo/snaps/stale/data"
echo exited > "$S/container-mawareeth-restic-19990101T000000Z-1-1-1"
touch "$S/concurrent-write"
run backup; rm -f "$S/concurrent-write"
expect_rc 0 'nightly backup'
status_is ok
[[ ! -d "$S/repo/snaps/stale" ]] || fail 'stale pending snapshot was not forgotten'
no_restic_leftovers 'nightly backup (stale container sweep)'
[[ "$(snaps_with pending)" == 0 && "$(snaps_with complete)" == 4 ]] || fail 'backup did not leave exactly four complete snapshots'
run_tag="run:$(field "$state/backup/last-backup" run)"
[[ "$(snaps_with "$run_tag")" == 4 ]] || fail 'dump, manifest, globals, and host state do not share the run tag'
for key in dump_snapshot manifest_snapshot globals_snapshot host_state_snapshot; do
  id="$(field "$state/backup/last-backup" "$key")"
  # shellcheck disable=SC2015 # fail exits, so it runs only when the check fails.
  [[ -n "$id" && -d "$S/repo/snaps/$id" ]] && grep -qx complete "$S/repo/snaps/$id/tags" || fail "last-backup $key does not name a complete snapshot after tagging"
done
dump_dir="$(snap_dir_of "$run_tag" /mawareeth.dump)"; manifest_dir="$(snap_dir_of "$run_tag" /manifest.tsv)"
[[ -n "$dump_dir" && -n "$manifest_dir" ]] || fail 'dump or manifest snapshot is missing'
[[ "$(< "$manifest_dir/data")" == "$good_counts" ]] || fail 'manifest does not hold the snapshot counts and checksums'
grep -qx 'pg-major:17' "$dump_dir/tags" || fail 'the dump is not tagged pg-major:17'
[[ "$(snaps_with pg-major:17)" == 1 ]] || fail 'only the dump may carry the pg-major tag'
[[ "$(field "$state/backup/last-backup" pg_major)" == 17 ]] || fail 'last-backup does not record pg_major=17'
cmp -s "$S/prod-settings" "$S/expected-settings" || fail 'the backup session did not apply the output settings before the checksum query'
globals_dir="$(snap_dir_of "$run_tag" /globals.sql)"
[[ -n "$globals_dir" && "$(field "$state/backup/last-backup" globals_snapshot)" == "${globals_dir##*/}" ]] || fail 'the globals snapshot is missing or not recorded'
grep -qx -- '-- PostgreSQL database cluster dump' "$globals_dir/data" || fail 'globals.sql does not hold the pg_dumpall output'
need "$S/dumpall-args" '1 pg_dumpall --globals-only -U mawareeth -l mawareeth'
grep -Eq '^restic -o sftp\.command=.* backup --stdin --stdin-filename globals\.sql --host mawareeth --tag pending,run:[0-9]{8}T[0-9]{6}Z-[0-9]+ --quiet$' "$S/restic.log" \
  || fail 'globals were not stored pending under their run tag'
grep -Eq ' dump [0-9a-f]+ /globals\.sql$' "$S/restic.log" || fail 'the stored globals were not read back'
! grep -rlq 'stub-role-hash' "$state" "$etc" "$tmp/out" || fail 'the cluster globals reached the host disk or the terminal'
[[ "$(head -c 5 "$dump_dir/data")" == PGDMP ]] || fail 'stored dump is not a custom-format archive'
[[ "$(tail -c +6 "$dump_dir/data")" == "$(< "$manifest_dir/data")" ]] || fail 'dump and counts describe different data (snapshot not shared)'
host_state_dir="$(snap_dir_of "$run_tag" /host-state.tar)"
[[ -n "$host_state_dir" ]] || fail 'the host-state snapshot is missing'
[[ "$(tar -tf "$host_state_dir/data" | LC_ALL=C sort)" == "$expected_host_state" ]] \
  || fail "the host-state archive does not hold exactly the expected paths: $(tar -tf "$host_state_dir/data" | tr '\n' ' ')"
! tar -tf "$host_state_dir/data" | grep -Fq '.tmp.abc' || fail 'a stray slots/.tmp.* file was archived'
[[ "$(tar -tf "$host_state_dir/data" | grep -cF "$snap_a")" == 1 ]] || fail 'a snapshot named by two records was not archived exactly once'
grep -Eq ' dump [0-9a-f]+ /host-state\.tar$' "$S/restic.log" || fail 'the stored host-state archive was not read back'
cmp -s <(tar -xOf "$host_state_dir/data" "${etc#/}/runtime.env") "$etc/runtime.env" || fail 'the host-state archive does not hold runtime.env'
cmp -s <(tar -xOf "$host_state_dir/data" "$rel_state/$snap_b") "$state/$snap_b" || fail 'the host-state archive does not hold the .prev snapshot'
grep -Eq '^restic -o sftp\.command=.* backup --stdin --stdin-filename host-state\.tar --host mawareeth --tag pending,run:[0-9]{8}T[0-9]{6}Z-[0-9]+ --quiet$' "$S/restic.log" \
  || fail 'host state was not stored pending under its run tag'
[[ -z "$(find "$state" "$etc" -name '*.tar' -print -quit)" ]] || fail 'the host-state archive was written to disk'
[[ "$(< "$S/dump-txn")" == open && "$(< "$S/txn")" == committed ]] || fail 'pg_dump did not run inside the open snapshot transaction'
need "$S/dump-args" '1 pg_dump -Fc --snapshot=00000003-0000001B-1'
[[ "$(< "$S/psql-timeout")" == 1 ]] || fail 'psql did not run under an in-container timeout'
need "$S/retention" 'forget --host mawareeth --tag complete --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune'
grep -Eq '^restic -o sftp\.command=.* backup --stdin --stdin-filename mawareeth\.dump --host mawareeth --tag pending,run:[0-9]{8}T[0-9]{6}Z-[0-9]+,pg-major:17 --quiet$' "$S/restic.log" \
  || fail 'dump was not stored pending under its run and pg-major tags'
need "$S/restic.log" 'backup --stdin --stdin-filename manifest.tsv'
grep -E '^docker run --rm -i --name mawareeth-restic-[0-9TZ]+-[0-9]+-[0-9]+-[0-9]+ .*restic\.password:/run/mawareeth/restic\.password:ro .*storagebox_ed25519:/run/mawareeth/storagebox_ed25519:ro .*known_hosts:ro .*mawareeth-restic-cache:/cache' "$S/calls.log" >/dev/null \
  || fail 'Restic did not run named, with read-only secret mounts and the cache volume'
! grep -E '^docker run --rm .*--network' "$S/calls.log" >/dev/null || fail 'unexpected network override for Restic'
no_secrets 'nightly backup'; no_plain_dump 'nightly backup'
[[ -z "$(find "$state" -name '.tmp.*' ! -path "$state/slots/.tmp.abc" -print -quit)" ]] || fail 'status publication left a temporary file'
! grep -rq 'restic-repository-password-NEVER-PRINT' "$state/backup/logs" || fail 'a run log contains the repository password'
if ((modes_work)); then
  for log in "$state"/backup/logs/*.log; do [[ "$("$real_stat" -c %a "$log")" == 600 ]] || fail "run log $log is not mode 0600"; done
else
  printf 'note: this filesystem cannot represent 0600; run-log mode check skipped\n' >&2
fi

# --- Same-second runs: a failed run forgets only its own snapshots ---------------
"$real_date" -u +%Y%m%dT%H%M%SZ > "$S/fixed-stamp"
run backup; expect_rc 0 'backup before a same-second failure'
first_tag="run:$(field "$state/backup/last-backup" run)"
touch "$S/fail-pg-dump"; run backup; rm -f "$S/fail-pg-dump" "$S/fixed-stamp"
expect_rc 5 'same-second failed backup'
[[ "run:$(field "$state/backup/last-backup" run)" != "$first_tag" ]] || fail 'same-second runs share a run tag'
[[ "$(snaps_with "$first_tag")" == 4 ]] || fail 'a failed run forgot an earlier same-second run'
[[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'a same-second failed run left its own snapshots'

# --- Backup failures ------------------------------------------------------------
complete_before="$(snaps_with complete)"
touch "$S/fail-pg-dump"; run backup; rm -f "$S/fail-pg-dump"
expect_rc 5 'failed pg_dump'
status_is failed:dump
[[ "$(snaps_with pending)" == 0 ]] || fail 'failed run left pending snapshots'
[[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'failed run left snapshots behind'
[[ "$(snaps_with complete)" == "$complete_before" ]] || fail 'failed run changed complete snapshots'
no_secrets 'failed pg_dump'; no_restic_leftovers 'failed pg_dump'

touch "$S/term-on-pg-dump"; run backup
expect_rc 5 'terminated backup'
[[ "$(field "$state/backup/last-backup" result)" == failed:* ]] || fail 'terminated backup did not record a failure'
[[ "$(snaps_with pending)" == 0 && "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'terminated backup left snapshots'

touch "$S/fail-tag-partial"; run backup; rm -f "$S/fail-tag-partial"
expect_rc 5 'partial tag failure'
status_is failed:tag
[[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'partial tagging left an orphan snapshot of the run'
[[ "$(snaps_with complete)" == "$complete_before" ]] || fail 'partial tagging changed earlier complete snapshots'

touch "$S/fail-retention"; run backup; rm -f "$S/fail-retention"
expect_rc 5 'retention failure'
status_is failed:retention
[[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 4 ]] || fail 'retention failure discarded the valid complete run'

# The globals stage: a failed pg_dumpall or upload fails the run at globals
# and discards it; globals that do not read back as a cluster dump fail verify.
touch "$S/fail-pg-dumpall"; run backup; rm -f "$S/fail-pg-dumpall"
expect_rc 5 'failed pg_dumpall'; status_is failed:globals; need "$tmp/out" 'pg_dumpall --globals-only failed'
[[ "$(snaps_with pending)" == 0 && "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'a failed pg_dumpall left snapshots of the run'
no_restic_leftovers 'failed pg_dumpall'
touch "$S/fail-restic-backup-globals.sql"; run backup; rm -f "$S/fail-restic-backup-globals.sql"
expect_rc 5 'failed globals upload'; status_is failed:globals; need "$tmp/out" 'storing the cluster globals in the repository failed'
[[ "$(snaps_with pending)" == 0 && "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'a failed globals upload left snapshots of the run'
touch "$S/globals-no-header"; run backup; rm -f "$S/globals-no-header"
expect_rc 5 'globals without the cluster dump header'; status_is failed:verify; need "$tmp/out" 'not a pg_dumpall cluster dump'
[[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'unreadable globals left snapshots of the run'

# A server_version_num that is not a 5-6 digit number fails the run at dump.
touch "$S/bad-version"; run backup; rm -f "$S/bad-version"
expect_rc 5 'invalid server_version_num'; status_is failed:dump; need "$tmp/out" 'invalid server_version_num'
[[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'an invalid version left snapshots of the run'

# A slot record naming a missing snapshot fails the run at host-state.
mv "$state/$snap_b" "$tmp/snap_b.moved"; run backup; mv "$tmp/snap_b.moved" "$state/$snap_b"
expect_rc 5 'missing referenced snapshot'
status_is failed:host-state
need "$tmp/out" 'green.env.prev slot record is missing'
[[ "$(snaps_with pending)" == 0 && "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'a host-state failure left snapshots of the run'
no_restic_leftovers 'missing referenced snapshot'

# An unusable slot record or a missing routes directory also fails at host-state.
cp "$state/slots/blue.env" "$tmp/blue.env.good"; printf 'IMAGE=bad\n' > "$state/slots/blue.env"
run backup; cp "$tmp/blue.env.good" "$state/slots/blue.env"
expect_rc 5 'unusable slot record'; status_is failed:host-state
[[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'an unusable slot record left snapshots of the run'
mv "$state/routes" "$tmp/routes.moved"; run backup; mv "$tmp/routes.moved" "$state/routes"
expect_rc 5 'missing routes directory'; status_is failed:host-state
[[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'a missing routes directory left snapshots of the run'
mv "$state/routes/active-slot.caddy" "$tmp/route.moved"; run backup; mv "$tmp/route.moved" "$state/routes/active-slot.caddy"
expect_rc 5 'missing route file'; status_is failed:host-state
[[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'a missing route file left snapshots of the run'

# tar failing after writing some bytes, or Restic failing to store only the
# archive, fails the run at host-state and discards it.
touch "$S/fail-tar"; run backup; rm -f "$S/fail-tar"
expect_rc 5 'failed tar'; status_is failed:host-state; need "$tmp/out" 'archiving the host state failed'
[[ "$(snaps_with pending)" == 0 && "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'a failed tar left snapshots of the run'
touch "$S/fail-restic-backup-host-state.tar"; run backup; rm -f "$S/fail-restic-backup-host-state.tar"
expect_rc 5 'failed host-state upload'; status_is failed:host-state; need "$tmp/out" 'storing the host state in the repository failed'
[[ "$(snaps_with pending)" == 0 && "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'a failed host-state upload left snapshots of the run'
no_restic_leftovers 'failed host-state upload'

# runtime.env turning into a symlink after validation fails at host-state.
if ((symlinks_work)); then
  touch "$S/symlink-runtime-on-dump"; run backup
  rm -f "$etc/runtime.env"; mv "$etc/runtime.env.real" "$etc/runtime.env"
  expect_rc 5 'symlinked runtime file'; status_is failed:host-state; need "$tmp/out" 'not a regular file'
  [[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'a symlinked runtime file left snapshots of the run'
else
  printf 'note: this filesystem cannot hold symlinks; the symlinked runtime-file check skipped\n' >&2
fi

# With no slots directory the archive holds runtime.env and routes only; an
# empty one adds just its own entry.
mv "$state/slots" "$tmp/slots.moved"; run backup
expect_rc 0 'backup without a slots directory'
[[ "$(listing_of "$(field "$state/backup/last-backup" run)")" == "$(LC_ALL=C sort <<<"$host_state_base")" ]] \
  || fail "the host-state archive without slots is wrong: $(listing_of "$(field "$state/backup/last-backup" run)" | tr '\n' ' ')"
mkdir -p "$state/slots"; chmod 700 "$state/slots"; run backup; rm -rf "$state/slots"; mv "$tmp/slots.moved" "$state/slots"
expect_rc 0 'backup with an empty slots directory'
[[ "$(listing_of "$(field "$state/backup/last-backup" run)")" == "$(printf '%s\n' "$host_state_base" "$rel_state/slots/" | LC_ALL=C sort)" ]] \
  || fail "the host-state archive with empty slots is wrong: $(listing_of "$(field "$state/backup/last-backup" run)" | tr '\n' ' ')"

printf '%s\n' $'public.auth_user\t3\t1\npublic.estate\t7\t2' > "$S/db-counts"
run backup; printf '%s\n' "$good_counts" > "$S/db-counts"
expect_rc 5 'manifest without django_migrations'
status_is failed:manifest
need "$tmp/out" 'lacks public.django_migrations'
[[ "$(snaps_with "run:$(field "$state/backup/last-backup" run)")" == 0 ]] || fail 'refused manifest left snapshots'

rm -f "$S/running-postgres"; run backup; touch "$S/running-postgres"
expect_rc 5 'no PostgreSQL container'; status_is failed:postgres; need "$tmp/out" 'no running mawareeth PostgreSQL container'
touch "$S/two-postgres"; run backup; rm -f "$S/two-postgres"
expect_rc 5 'two PostgreSQL containers'; need "$tmp/out" 'found several'

touch "$S/repo-unreachable"; run backup; rm -f "$S/repo-unreachable"
expect_rc 5 'unreachable repository'
status_is failed:repository
need "$tmp/out" 'unreachable or rejected the connection'
no_secrets 'unreachable repository'
need "$(field "$state/backup/last-backup" log)" 'LEAKY-SSH-DETAIL'

# A timeout kills the docker client but its container lives on: it is removed.
touch "$S/hang-restic"; run MAWAREETH_BACKUP_REPO_TIMEOUT=1 backup
expect_rc 5 'timed-out Restic'
grep -E '^docker rm -f mawareeth-restic-' "$S/calls.log" >/dev/null || fail 'the timed-out Restic container was not force-removed'
no_restic_leftovers 'timed-out Restic'

echo running > "$S/container-mawareeth-restic-19990101T000000Z-1-1-1"
run backup
expect_rc 5 'running leftover Restic container'
status_is failed:setup
need "$tmp/out" 'is still running'
rm -f "$S/container-mawareeth-restic-19990101T000000Z-1-1-1"

# --- Concurrent runs --------------------------------------------------------------
cp "$state/backup/last-backup" "$tmp/status-before"
for command in backup verify-restore; do
  if [[ -n "$real_flock" ]]; then
    exec 7>>"$state/backup.lock"; "$real_flock" -n 7
    run "$command"
    exec 7>&-
  else
    touch "$S/lock-held"; run "$command"; rm -f "$S/lock-held"
  fi
  expect_rc 3 "concurrent $command"
  [[ "$(docker_mutations)" == 0 ]] || fail "a locked-out $command ran Docker"
done
cmp -s "$tmp/status-before" "$state/backup/last-backup" || fail 'a locked-out backup changed the status'

# --- Restore passes on the newest complete pair -----------------------------------
# Distinct seconds keep these runs ordered by their stamp-prefixed tags below.
sleep 1
run backup; expect_rc 0 'first backup before restore'
sleep 1
run backup; expect_rc 0 'second backup before restore'
latest_run="$(field "$state/backup/last-backup" run)"
run verify-restore
expect_rc 0 'restore verification'
evidence_is pass
[[ "$(field "$state/backup/restore-verified" backup_run)" == "$latest_run" ]] || fail 'restore did not use the newest backup'
[[ "$(field "$state/backup/restore-verified" tables)" == 3 ]] || fail 'evidence does not record the table count'
[[ "$(field "$state/backup/restore-verified" content_checksums)" == 1 ]] || fail 'evidence does not record content_checksums=1'
[[ "$(field "$state/backup/restore-verified" dump_pg_major)" == 17 && "$(field "$state/backup/restore-verified" restore_pg_major)" == 17 ]] \
  || fail 'evidence does not record dump_pg_major=17 and restore_pg_major=17'
[[ "$(< "$S/restore-sql-kind")" == checksum ]] || fail 'a checksum manifest was not verified with the checksum query'
cmp -s "$S/restore-settings" "$S/expected-settings" || fail 'the restore session did not apply the output settings before the checksum query'
[[ "$(field "$state/backup/restore-verified" rto_seconds)" == 14400 && "$(field "$state/backup/restore-verified" rpo_seconds)" == 86400 ]] || fail 'evidence lacks RPO/RTO'
need "$S/restic.log" ' check'
! grep -E ' check .*--read-data' "$S/restic.log" >/dev/null || fail 'restic check must not read all data'
need "$S/restore-run" '--network none'
need "$S/restore-run" 'docker.io/library/postgres:17.11@sha256:'
need "$S/restore-run" 'com.mawareeth.role=restore-check'
! grep -Fq 'mawareeth-postgres-data' "$S/restore-run" || fail 'restore targeted the production volume'
need "$S/restore-args" '1 pg_restore --exit-on-error --no-owner --no-acl'
grep -E '^docker exec mawareeth-restore-[^ ]+ pg_isready -h 127\.0\.0\.1' "$S/calls.log" >/dev/null || fail 'readiness was not checked over TCP'
no_restore_leftovers 'restore verification'; no_restic_leftovers 'restore verification'; no_secrets 'restore verification'; no_plain_dump 'restore verification'
run gate
expect_rc 0 'gate after a passing restore'
run status
expect_rc 0 'status'
need "$tmp/out" 'result=pass'

# A pair tagged in the legacy run:<stamp> format is still selected.
legacy_run="${latest_run%-*}"
for d in "$S"/repo/snaps/*/; do sed -i "s/^run:$latest_run\$/run:$legacy_run/" "$d/tags"; done
run verify-restore
expect_rc 0 'restore of a legacy-tagged pair'
[[ "$(field "$state/backup/restore-verified" backup_run)" == "$legacy_run" ]] || fail 'restore did not select the legacy-tagged pair'
for d in "$S"/repo/snaps/*/; do sed -i "s/^run:$legacy_run\$/run:$latest_run/" "$d/tags"; done

# A run from before host-state archiving (no host-state.tar) still restores.
rm -rf "$(snap_dir_of "run:$latest_run" /host-state.tar)"
run verify-restore
expect_rc 0 'restore of a run without host state'
[[ "$(field "$state/backup/restore-verified" backup_run)" == "$latest_run" ]] || fail 'restore skipped a run without host state'
run gate; expect_rc 0 'gate with a run without host state'

# The newest dump lacks its manifest: the older complete pair is used.
rm -rf "$(snap_dir_of "run:$latest_run" /manifest.tsv)"
older_run="$(for d in "$S"/repo/snaps/*/; do grep -x 'run:.*' "$d/tags"; done | sed 's/^run://' | sort -u | grep -vx "$latest_run" | tail -n 1)"
run verify-restore
expect_rc 0 'restore with the newest manifest missing'
[[ "$(field "$state/backup/restore-verified" backup_run)" == "$older_run" ]] || fail 'restore did not fall back to the older complete pair'

# --- Restore failures --------------------------------------------------------------
run backup; expect_rc 0 'backup before restore failures'
current_manifest="$(snap_dir_of "run:$(field "$state/backup/last-backup" run)" /manifest.tsv)"
cp "$current_manifest/data" "$tmp/manifest.good"
printf '%s\n' $'public.auth_user\t3\npublic.estate\t7' > "$current_manifest/data"
run verify-restore; expect_rc 6 'manifest without django_migrations'; evidence_is fail:manifest
printf '%s\n' $'public.auth_user\t3\npublic.django_migrations\tmany' > "$current_manifest/data"
run verify-restore; expect_rc 6 'malformed manifest'; evidence_is fail:manifest
# One counts-only line among checksum lines is refused.
{ head -n 1 "$tmp/manifest.good" | cut -f1,2; tail -n +2 "$tmp/manifest.good"; } > "$current_manifest/data"
run verify-restore; expect_rc 6 'mixed manifest'; evidence_is fail:manifest; need "$tmp/out" 'mixes counts-only and checksum lines'
cp "$tmp/manifest.good" "$current_manifest/data"
no_restore_leftovers 'manifest refusals'

# A run from the previous script (a counts-only manifest, a dump without a
# pg-major tag, and no globals.sql) still restores on counts alone and opens
# the gate.
current_run="$(field "$state/backup/last-backup" run)"
current_dump="$(snap_dir_of "run:$current_run" /mawareeth.dump)"
cut -f1,2 "$tmp/manifest.good" > "$current_manifest/data"
sed -i '/^pg-major:/d' "$current_dump/tags"
rm -rf "$(snap_dir_of "run:$current_run" /globals.sql)"
run verify-restore
expect_rc 0 'restore of a legacy run'; evidence_is pass
[[ "$(field "$state/backup/restore-verified" backup_run)" == "$current_run" ]] || fail 'restore skipped the legacy run'
[[ "$(field "$state/backup/restore-verified" content_checksums)" == 0 ]] || fail 'a legacy manifest must record content_checksums=0'
[[ -z "$(field "$state/backup/restore-verified" dump_pg_major)" && "$(field "$state/backup/restore-verified" restore_pg_major)" == 17 ]] \
  || fail 'a legacy dump must record an empty dump_pg_major'
[[ "$(< "$S/restore-sql-kind")" == legacy ]] || fail 'a legacy manifest was not verified with the counts-only query'
run gate; expect_rc 0 'gate after restoring a legacy run'
cp "$tmp/manifest.good" "$current_manifest/data"
no_restore_leftovers 'legacy restore'

# A dump taken from another PostgreSQL major is refused before pg_restore:
# a pg-major:16 dump on the 17 throwaway, and a 17 dump on a 16 throwaway.
printf 'pg-major:16\n' >> "$current_dump/tags"
rm -f "$S/restore-args"; run verify-restore
expect_rc 6 'dump from another major'; evidence_is fail:version-mismatch
[[ ! -e "$S/restore-args" ]] || fail 'pg_restore ran despite a major mismatch'
[[ "$(field "$state/backup/restore-verified" dump_pg_major)" == 16 && "$(field "$state/backup/restore-verified" restore_pg_major)" == 17 ]] \
  || fail 'a major mismatch must record both majors'
no_restore_leftovers 'major mismatch'
sed -i 's/^pg-major:16$/pg-major:17/' "$current_dump/tags"
touch "$S/restore-major"; rm -f "$S/restore-args"; run verify-restore; rm -f "$S/restore-major"
expect_rc 6 'throwaway on another major'; evidence_is fail:version-mismatch
[[ ! -e "$S/restore-args" ]] || fail 'pg_restore ran on a throwaway of another major'
no_restore_container_created() {
  ! grep -Eq '^docker (run -d|volume create .*mawareeth-restore-)' "$S/calls.log" || fail "$1 created a throwaway container or volume"
}
# A duplicate or malformed tag is refused before any throwaway exists.
printf 'pg-major:18\n' >> "$current_dump/tags"
run verify-restore; expect_rc 6 'duplicate pg-major tags'; evidence_is fail:version-mismatch
no_restore_container_created 'a duplicate pg-major tag'
sed -i '/^pg-major:18$/d' "$current_dump/tags"
sed -i 's/^pg-major:17$/pg-major:abc/' "$current_dump/tags"
run verify-restore; expect_rc 6 'malformed pg-major tag'; evidence_is fail:version-mismatch; need "$tmp/out" 'duplicate or malformed pg-major tag'
no_restore_container_created 'a malformed pg-major tag'
# A checksum run whose dump lacks the tag is a regression, not a legacy run.
sed -i '/^pg-major:/d' "$current_dump/tags"
run verify-restore; expect_rc 6 'checksum run without a pg-major tag'; evidence_is fail:version-mismatch
need "$tmp/out" 'lacks its pg-major tag'
no_restore_container_created 'a checksum run without a pg-major tag'
printf 'pg-major:17\n' >> "$current_dump/tags"
# A throwaway reporting an invalid server_version_num fails at setup.
touch "$S/restore-bad-version"; rm -f "$S/restore-args"; run verify-restore; rm -f "$S/restore-bad-version"
expect_rc 6 'throwaway with an invalid version'; evidence_is fail:setup; need "$tmp/out" 'invalid server_version_num'
[[ ! -e "$S/restore-args" ]] || fail 'pg_restore ran on a throwaway with an invalid version'
no_restore_leftovers 'throwaway with an invalid version'

# Equal counts with one differing value fail on the checksums.
touch "$S/restore-corrupt-value"; run verify-restore; rm -f "$S/restore-corrupt-value"
expect_rc 6 'restore value corrupted'; evidence_is fail:checksum-mismatch
need "$(field "$state/backup/restore-verified" log)" $'public.estate\t7\t42'
need "$tmp/out" 'differing tables are listed'
no_restore_leftovers 'restore value corrupted'

touch "$S/restore-drop-row"; run verify-restore; rm -f "$S/restore-drop-row"
expect_rc 6 'restore count mismatch'
evidence_is fail:count-mismatch
no_restore_leftovers 'restore count mismatch'
run gate
expect_rc 1 'gate after a failed restore'
need "$tmp/out" 'fail:count-mismatch, not pass'

touch "$S/fail-pg-restore"; run verify-restore; rm -f "$S/fail-pg-restore"
expect_rc 6 'pg_restore failure'; evidence_is fail:restore; no_restore_leftovers 'pg_restore failure'

touch "$S/fail-check"; run verify-restore; rm -f "$S/fail-check"
expect_rc 6 'restic check failure'; evidence_is fail:repository

touch "$S/term-on-restore"; run verify-restore
expect_rc 6 'terminated restore'; evidence_is fail:interrupted; no_restore_leftovers 'terminated restore'

touch "$S/slow-restore"; run verify-restore; rm -f "$S/slow-restore" "$S/clock-offset"
expect_rc 6 'slow restore'; evidence_is fail:slow; no_restore_leftovers 'slow restore'

touch "$S/fail-rm-restore"; run verify-restore; rm -f "$S/fail-rm-restore"
expect_rc 6 'container cleanup failure'; evidence_is fail:cleanup; need "$tmp/out" 'CRITICAL'
rm -f "$S"/container-mawareeth-restore-*
touch "$S/fail-volume-rm"; run verify-restore; rm -f "$S/fail-volume-rm"
expect_rc 6 'volume cleanup failure'; evidence_is fail:cleanup; need "$tmp/out" 'CRITICAL'
rm -f "$S"/volume-mawareeth-restore-*

touch "$S/fail-volume-ls-restore"; run verify-restore; rm -f "$S/fail-volume-ls-restore"
expect_rc 6 'volume inspection error'; evidence_is fail:setup
[[ -z "$(find "$S" -maxdepth 1 -name 'volume-mawareeth-restore-*' -print -quit)" ]] || fail 'a volume was created despite the inspection error'

echo 100 > "$S/disk-avail"; run verify-restore; rm -f "$S/disk-avail"
expect_rc 6 'insufficient disk'; evidence_is fail:setup; need "$tmp/out" 'bytes free'
[[ -z "$(find "$S" -maxdepth 1 -name 'container-mawareeth-restore-*' -print -quit)" ]] || fail 'restore started despite insufficient disk'

set_snapshot_times() { local d; for d in "$S"/repo/snaps/*/; do printf '%s\n' "$1" > "$d/time"; done; }
set_snapshot_times "$("$real_date" -u -d '+2 hours' +%Y-%m-%dT%H:%M:%S.000000000Z)"
run verify-restore; expect_rc 6 'future-dated dump'; evidence_is fail:stale; need "$tmp/out" 'in the future'
set_snapshot_times "$("$real_date" -u -d '-2 days' +%Y-%m-%dT%H:%M:%S.000000000Z)"
run verify-restore; expect_rc 6 'stale dump'; evidence_is fail:stale
[[ -z "$(find "$S" -maxdepth 1 -name 'container-mawareeth-restore-*' -print -quit)" ]] || fail 'stale restore started a container'

# --- Gate freshness ---------------------------------------------------------------
run backup; expect_rc 0 'fresh backup'
run verify-restore; expect_rc 0 'fresh restore'
run gate; expect_rc 0 'gate with fresh evidence'
cp "$state/backup/restore-verified" "$tmp/evidence.good"
old=$(( $("$real_date" -u +%s) - 36 * 86400 ))
sed -i "s/^verified_epoch=.*/verified_epoch=$old/" "$state/backup/restore-verified"
run gate; expect_rc 1 'gate with old evidence'; need "$tmp/out" 'limit 35 days'
sed -i 's/^verified_epoch=.*/verified_epoch=0123/' "$state/backup/restore-verified"
run gate; expect_rc 1 'gate with a malformed epoch'; need "$tmp/out" 'no valid verification time'
cp "$tmp/evidence.good" "$state/backup/restore-verified"
old=$(( $("$real_date" -u +%s) - 27 * 3600 ))
sed -i "s/^finished_epoch=.*/finished_epoch=$old/" "$state/backup/last-backup"
run gate; expect_rc 1 'gate with old backup'; need "$tmp/out" 'limit 26h'
touch "$S/fail-pg-dump"; run backup; rm -f "$S/fail-pg-dump"
run gate; expect_rc 1 'gate after a failed backup'; need "$tmp/out" 'failed:dump, not ok'

# --- Timers ---------------------------------------------------------------------------
run install
expect_rc 0 'install'
timer="$units/mawareeth-backup.timer"; check_timer="$units/mawareeth-restore-check.timer"
need "$timer" 'OnCalendar=*-*-* 02:30:00'
need "$timer" 'RandomizedDelaySec=15m'
need "$timer" 'Persistent=true'
need "$timer" 'Unit=mawareeth-backup.service'
need "$check_timer" 'OnCalendar=*-*-01 04:00:00'
need "$check_timer" 'Persistent=true'
need "$check_timer" 'Unit=mawareeth-restore-check.service'
for service in mawareeth-backup mawareeth-restore-check; do
  file="$units/$service.service"
  for line in 'Environment=HOME=/root' 'Type=oneshot' "Environment=MAWAREETH_RUNTIME_DIR=$state" 'TimeoutStartSec=5h' 'TimeoutStopSec=900' \
    'Nice=10' 'IOSchedulingClass=idle' 'CPUSchedulingPolicy=batch'; do
    need "$file" "$line"
  done
done
check_service="$units/mawareeth-restore-check.service"
for line in 'Restart=on-failure' 'RestartSec=1h' 'RestartPreventExitStatus=2' 'StartLimitIntervalSec=12h' 'StartLimitBurst=7'; do need "$check_service" "$line"; done
[[ "$(sed -n '/^\[Unit\]/,/^\[Service\]/p' "$check_service")" == *StartLimitBurst=7* ]] || fail 'start limits must be in the [Unit] section'
! grep -Fq 'Restart=' "$units/mawareeth-backup.service" || fail 'the nightly backup must not restart automatically'
need "$units/mawareeth-backup.service" "ExecStart=/bin/bash $bundle/deploy/backup.sh backup"
need "$check_service" "ExecStart=/bin/bash $bundle/deploy/backup.sh verify-restore"
need "$S/systemctl.log" 'systemctl daemon-reload'
need "$S/systemctl.log" 'systemctl enable --now mawareeth-backup.timer mawareeth-restore-check.timer'

printf 'deploy/backup.sh tests passed\n'
