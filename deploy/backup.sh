#!/usr/bin/env bash
# Encrypted off-host PostgreSQL backup, restore verification, and write gate.
#
#   sudo deploy/backup.sh init            create the Restic repository (once)
#   sudo deploy/backup.sh backup          nightly dump + manifest + globals + host state + retention
#   sudo deploy/backup.sh verify-restore  monthly isolated restore proof
#   sudo deploy/backup.sh gate            exit 0 only when recovery is proven
#   sudo deploy/backup.sh status          show the last backup and evidence
#   sudo deploy/backup.sh install         write and enable the systemd timers
#
# Exit codes: 0 success; 1 the gate is not satisfied; 2 refused before any
# mutation (invalid input or configuration); 3 another backup operation holds
# the backup lock; 5 the backup or a repository operation failed; 6 restore
# verification failed; 129/130/143 a hangup, interrupt, or termination arrived
# before the operation started (afterwards they map to 5 or 6). Restic runs
# only from the digest-pinned image; its secrets stay in root-only files under
# /etc/mawareeth and are mounted read-only, never passed on a command line or
# written to logs. This script never takes the deploy lock and never writes
# slots, routes, the deploy journal, or runtime snapshots; it only reads the
# runtime file, slots, routes, and the snapshots the slot records name, to
# stream them as an encrypted host-state archive (the journal is not read).
# Each run stores four snapshots under one run: tag: the dump (also tagged
# pg-major:<N>), the manifest of per-table row counts and content checksums,
# the cluster globals (pg_dumpall --globals-only, never restored
# automatically; without role password hashes when the backup role is not a
# superuser, recorded as globals_role_passwords=0), and the host state.
# verify-restore refuses a dump whose PostgreSQL major differs from the
# throwaway server's, then compares counts and, for checksum manifests, content
# checksums; both sessions compute them with an empty search_path. The RTO
# covers the whole run, including that comparison; restore_seconds records the
# part spent up to the end of pg_restore.
backup_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/runtime.sh
source "$backup_script_dir/runtime.sh"

config_dir="${MAWAREETH_BACKUP_CONFIG_DIR:-/etc/mawareeth}"
backup_env_file="$config_dir/backup.env"
password_file="$config_dir/restic.password"
ssh_key_file="$config_dir/storagebox_ed25519"
known_hosts_file="$config_dir/storagebox_known_hosts"
systemd_dir="${MAWAREETH_SYSTEMD_DIR:-/etc/systemd/system}"
backup_dir="$state_dir/backup"
backup_logs_dir="$backup_dir/logs"
backup_lock_file="$state_dir/backup.lock"
status_file="$backup_dir/last-backup"
evidence_file="$backup_dir/restore-verified"
cache_volume=mawareeth-restic-cache
dump_name=mawareeth.dump
manifest_name=manifest.tsv
host_state_name=host-state.tar
globals_name=globals.sql
globals_header='-- PostgreSQL database cluster dump'
restic_host=mawareeth
secret_mount=/run/mawareeth
retention=(--keep-daily 7 --keep-weekly 4 --keep-monthly 6)
rpo_seconds=86400
rto_seconds=14400
clock_skew_seconds=300
evidence_max_age=$((35 * 86400))
backup_max_age=$((26 * 3600))
# Every stage is capped against one overall run deadline: the backup budget,
# or the RTO for verify-restore. With the bounded failure cleanup (well under
# 600s) the total stays strictly below the units' TimeoutStartSec=5h.
backup_budget="${MAWAREETH_BACKUP_BUDGET:-14400}"
backup_timeout="${MAWAREETH_BACKUP_TIMEOUT:-10800}"
repo_timeout="${MAWAREETH_BACKUP_REPO_TIMEOUT:-3600}"
start_timeout="${MAWAREETH_BACKUP_START_TIMEOUT:-300}"
poll_interval="${MAWAREETH_BACKUP_POLL_INTERVAL:-2}"
cleanup_timeout=60
forget_timeout=240
read_timeout=60
coproc_grace=120
disk_factor=3
unit_start_timeout=5h
unit_stop_timeout=900
counts_end='mawareeth-counts-end'
tab=$'\t'
# One exact count(*) and an order-independent content checksum per user
# table in a stable order, as "<key><TAB>N<TAB>checksum". The checksum is the
# sum of the signed 64-bit prefixes of md5(row::text): constant memory, no sort,
# and it detects corruption (Restic already authenticates the archive). The key
# is format('%I.%I'), hex-encoded when it would contain a control character, so
# no table name can break the line format. Other sessions' temporary schemas
# are excluded. Both sessions (backup and restore) run output_settings_sql
# first so every row renders to the same text; its empty search_path is safe
# because every table name is %I.%I-qualified and every function and type is
# in pg_catalog, which is always searched.
table_list_sql="FROM (SELECT schemaname, tablename, format('%I.%I', schemaname, tablename) AS k FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') AND schemaname !~ '^pg_(toast_)?temp_') AS t ORDER BY schemaname, tablename \\gexec"
table_key_sql="CASE WHEN k ~ '[[:cntrl:]]' THEN 'hex:' || encode(convert_to(k, 'UTF8'), 'hex') ELSE k END"
count_sql="SELECT format('SELECT %L, count(*), coalesce(sum((''x'' || left(md5(t.*::text), 16))::bit(64)::bigint::numeric), 0) FROM %I.%I AS t', $table_key_sql, schemaname, tablename) $table_list_sql"
count_line_re='^[^[:cntrl:]]+'$'\t''[0-9]+'$'\t''-?[0-9]+$'
# Manifests written before content checksums hold "<key><TAB>N" only; they are
# verified on counts alone with the original query.
legacy_count_sql="SELECT format('SELECT %L, count(*) FROM %I.%I', $table_key_sql, schemaname, tablename) $table_list_sql"
legacy_count_line_re='^[^[:cntrl:]]+'$'\t''[0-9]+$'
output_settings_sql="SET TimeZone = 'UTC';
SET DateStyle = 'ISO, YMD';
SET IntervalStyle = 'postgres';
SET extra_float_digits = 1;
SET bytea_output = 'hex';
SET lc_monetary = 'C';
SET search_path = '';"
# server_version_num of PostgreSQL 10 or later (six digits), and the
# two-digit major (10-99) it yields; major_re is also the only pattern for
# pg-major:<N> tags, here and in Python.
version_re='^[1-9][0-9]{5}$'
major_re='^[1-9][0-9]$'
migrations_key='public.django_migrations'

mode=''
stage=preflight
outcome_written=0
run_stamp=''
run_log=/dev/null
run_token=''
run_deadline=0
cap_value=0
restic_seq=0
restic_repository=''
sftp_command=''
pg_container=''
pg_user=''
pg_db=''
psql_in=''
psql_pid=''
manifest=''
dump_id=''
manifest_id=''
host_state_id=''
globals_id=''
pg_major=''
pg_superuser=''
globals_role_passwords=''
content_checksums=''
dump_pg_major=''
restore_pg_major=''
restore_seconds=''
restore_container=''
restore_volume=''
restore_started=0

now_epoch() { date -u +%s; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Terminal output never aborts an operation (e.g. a closed SSH session).
say() {
  if ! printf 'backup: %s\n' "$*" >&2 2>/dev/null; then :; fi
  if [[ "$run_log" != /dev/null ]]; then
    if ! printf '%s backup: %s\n' "$(now_iso)" "$*" >> "$run_log" 2>/dev/null; then :; fi
  fi
}

bounded_seconds() {
  [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] || die "$2 must be 1-99999 seconds"
}

clean_path() {
  [[ "$1" =~ ^/[A-Za-z0-9._/-]+$ && "/$1/" != */../* ]] || die "$2 must be an absolute path of [A-Za-z0-9._/-] characters"
}

# cap SECONDS sets cap_value to SECONDS limited by the run deadline; an
# exhausted budget fails the run (restore: as "slow").
cap() {
  local want="$1" left
  left=$((run_deadline - $(now_epoch)))
  if ((left < 1)); then
    if [[ "$mode" == restore ]]; then restore_fail slow "the ${rto_seconds}s RTO budget was spent before stage $stage"; fi
    backup_fail "$stage" "the ${backup_budget}s backup budget was spent"
  fi
  ((want <= left)) || want="$left"
  cap_value="$want"
}

# pg_major_of VERSION NAME sets the variable NAME to the major of a
# server_version_num; returns 1 (NAME unchanged) unless VERSION matches
# version_re.
pg_major_of() {
  [[ "$1" =~ $version_re ]] || return 1
  printf -v "$2" '%s' "$((10#$1 / 10000))"
}

# load_backup_env parses the raw backup.env with its own three-key allowlist;
# runtime.sh keeps its own allowlist for runtime.env (eight required keys plus
# five optional SITE_ID and social-login keys).
load_backup_env() {
  local line key value
  declare -gA backup_values=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] || die 'backup file contains a blank line'
    [[ "$line" != *$'\r'* && "$line" != [[:space:]]* && "$line" != *[[:space:]] ]] || die 'backup file contains whitespace'
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || die 'backup file must contain raw KEY=VALUE lines'
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    [[ -z "${backup_values[$key]+x}" ]] || die "backup file contains duplicate key: $key"
    [[ -n "$value" ]] || die "backup value is empty: $key"
    [[ "$value" != *[$'\001'-$'\037'$'\177']* ]] || die "backup value contains a control character: $key"
    backup_values[$key]="$value"
  done < "$backup_env_file"
  local expected=' RESTIC_REPOSITORY_PATH STORAGE_BOX_HOST STORAGE_BOX_USER '
  for key in "${!backup_values[@]}"; do [[ "$expected" == *" $key "* ]] || die "backup file contains unsupported key: $key"; done
  for key in RESTIC_REPOSITORY_PATH STORAGE_BOX_HOST STORAGE_BOX_USER; do
    [[ -n "${backup_values[$key]:-}" ]] || die "backup file is missing required key: $key"
  done
  [[ "${backup_values[STORAGE_BOX_USER]}" =~ ^u[0-9]+(-sub[0-9]+)?$ ]] || die 'STORAGE_BOX_USER must be a Storage Box account such as u123456-sub1'
  validate_hostname "${backup_values[STORAGE_BOX_HOST]}" STORAGE_BOX_HOST lowercase
  [[ "${backup_values[RESTIC_REPOSITORY_PATH]}" =~ ^/?[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ \
    && "/${backup_values[RESTIC_REPOSITORY_PATH]}/" != */../* && "/${backup_values[RESTIC_REPOSITORY_PATH]}/" != */./* ]] \
    || die 'RESTIC_REPOSITORY_PATH must be a plain path of [A-Za-z0-9._-] segments'
  local account="${backup_values[STORAGE_BOX_USER]}@${backup_values[STORAGE_BOX_HOST]}"
  restic_repository="sftp:$account:${backup_values[RESTIC_REPOSITORY_PATH]}"
  sftp_command="ssh -p 23 -i $secret_mount/storagebox_ed25519 -o UserKnownHostsFile=$secret_mount/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=30 -o ServerAliveInterval=30 -o ServerAliveCountMax=4 $account -s sftp"
}

secret_file() {
  file_metadata "$1" 600 "$2"
  [[ -s "$1" ]] || die "$2 is empty"
}

known_hosts_metadata() {
  local metadata
  [[ -f "$known_hosts_file" && ! -L "$known_hosts_file" ]] || die 'Storage Box known_hosts must be a regular non-symlink file'
  metadata="$(stat -c '%u:%g:%a' "$known_hosts_file" 2>/dev/null)" || die 'cannot inspect Storage Box known_hosts'
  [[ "$metadata" == 0:0:600 || "$metadata" == 0:0:644 ]] || die 'Storage Box known_hosts must be owned by root:root with mode 600 or 644'
  [[ -s "$known_hosts_file" ]] || die 'Storage Box known_hosts is empty; pin the Storage Box host key first'
}

# load_backup_config validates every input before any mutation (exit 2).
load_backup_config() {
  [[ ${EUID:-999} -eq 0 ]] || die 'must run as root'
  local tool
  for tool in docker flock timeout python3 stat mktemp mv sync install head cat date df tar; do require_command "$tool"; done
  bounded_seconds "$backup_budget" MAWAREETH_BACKUP_BUDGET
  ((backup_budget <= 14400)) || die 'MAWAREETH_BACKUP_BUDGET must not exceed 14400 seconds (the units allow 5h)'
  bounded_seconds "$backup_timeout" MAWAREETH_BACKUP_TIMEOUT
  bounded_seconds "$repo_timeout" MAWAREETH_BACKUP_REPO_TIMEOUT
  bounded_seconds "$start_timeout" MAWAREETH_BACKUP_START_TIMEOUT
  bounded_seconds "$poll_interval" MAWAREETH_BACKUP_POLL_INTERVAL
  clean_path "$config_dir" MAWAREETH_BACKUP_CONFIG_DIR
  clean_path "$state_dir" MAWAREETH_RUNTIME_DIR
  safe_path "$runtime_file" MAWAREETH_RUNTIME_FILE
  safe_path "$lock_file" MAWAREETH_RUNTIME_IMAGE_LOCK
  file_metadata "$backup_env_file" 600 'backup file'
  load_backup_env
  secret_file "$password_file" 'Restic password file'
  secret_file "$ssh_key_file" 'Storage Box SSH key'
  known_hosts_metadata
  file_metadata "$runtime_file" 600 'runtime file'
  load_raw_env "$runtime_file"
  validate_values
  pg_user="${runtime_values[POSTGRES_USER]}"
  pg_db="${runtime_values[POSTGRES_DB]}"
  file_metadata "$lock_file" 644 'runtime image lock'
  load_lock
  [[ -n "${locked[RESTIC_IMAGE]:-}" ]] || die 'runtime image lock has no RESTIC_IMAGE entry'
  validate_image "${locked[RESTIC_IMAGE]}"
  ensure_state_dir existing
  state_subdir "$backup_dir" 700 create
  state_subdir "$backup_logs_dir" 700 create
}

# A non-blocking lock on descriptor 8, held for the rest of the process.
# Docker invocations close it (8>&-) so no container outlives it holding it.
acquire_backup_lock() {
  exec 8>>"$backup_lock_file" || die "cannot open $backup_lock_file"
  if ! flock -n 8; then
    say "another backup operation holds $backup_lock_file; nothing was changed"
    exit 3
  fi
}

open_run_log() {
  local file
  run_stamp="$(date -u +%Y%m%dT%H%M%SZ)" || die 'cannot read the clock'
  run_token="$run_stamp-$$"
  file="$backup_logs_dir/$1-$run_token.log"
  (set -C; : > "$file") 2>/dev/null || die "cannot create diagnostic log $file"
  { chown root:root "$file" && chmod 0600 "$file"; } || die "cannot protect diagnostic log $file"
  file_metadata "$file" 600 'diagnostic log'
  run_log="$file"
}

# container_present NAME: 0 present, 1 absent, 2 Docker error.
container_present() {
  local found
  found="$(timeout "$cleanup_timeout" docker ps -a -q --filter "name=^$1\$" 2>>"$run_log" 8>&-)" || return 2
  [[ -n "${found//$'\r'/}" ]]
}

# volume_present NAME: 0 present, 1 absent, 2 Docker error.
volume_present() {
  local found
  found="$(timeout "$cleanup_timeout" docker volume ls --quiet --filter "name=^$1\$" 2>>"$run_log" 8>&-)" || return 2
  [[ -n "${found//$'\r'/}" ]]
}

# reap_container NAME force-removes a container that may outlive its client
# (e.g. after a timeout killed `docker run`); returns 1 if it may remain.
reap_container() {
  local present=0
  container_present "$1" || present=$?
  case "$present" in
    1) return 0 ;;
    2) say "cannot check for leftover container $1"; return 1 ;;
  esac
  if ! timeout "$cleanup_timeout" docker rm -f "$1" >>"$run_log" 2>&1 8>&-; then say "could not remove leftover container $1"; return 1; fi
}

# restic_cmd LIMIT stdin|none ARGS... runs the pinned Restic image under a
# deterministic name with the secrets mounted read-only and the repository
# location in the environment; on failure or timeout the container is removed.
restic_cmd() {
  local limit="$1" input="$2" name status=0; shift 2
  local -a interactive=()
  [[ "$input" != stdin ]] || interactive=(-i)
  restic_seq=$((restic_seq + 1))
  name="mawareeth-restic-$run_token-$BASHPID-$restic_seq"
  RESTIC_REPOSITORY="$restic_repository" timeout --kill-after=30 "$limit" docker run --rm "${interactive[@]}" \
    --name "$name" --label com.mawareeth.owner=mawareeth --label com.mawareeth.role=restic \
    --label "com.mawareeth.backup-run=$run_token" --hostname mawareeth-backup \
    -v "$password_file:$secret_mount/restic.password:ro" -v "$ssh_key_file:$secret_mount/storagebox_ed25519:ro" \
    -v "$known_hosts_file:$secret_mount/known_hosts:ro" -v "$cache_volume:/cache" \
    -e RESTIC_REPOSITORY -e "RESTIC_PASSWORD_FILE=$secret_mount/restic.password" -e RESTIC_CACHE_DIR=/cache \
    "${locked[RESTIC_IMAGE]}" -o "sftp.command=$sftp_command" "$@" 2>>"$run_log" 8>&- || status=$?
  if ((status != 0)); then
    say "restic ${1:-} exited with status $status"
    if ! reap_container "$name"; then :; fi
  fi
  return "$status"
}
restic_in() { restic_cmd "$1" stdin "${@:2}"; }
restic_run() { restic_cmd "$1" none "${@:2}" < /dev/null; }

# sweep_restic_containers removes Restic containers left by earlier runs;
# returns 3 when one is still running and 2 on a Docker error.
sweep_restic_containers() {
  local listing name state
  listing="$(timeout "$cleanup_timeout" docker ps -a --filter label=com.mawareeth.role=restic --format '{{.Names}} {{.State}}' 2>>"$run_log" 8>&-)" || return 2
  while IFS=' ' read -r name state; do
    [[ -n "$name" ]] || continue
    [[ "$name" =~ ^mawareeth-restic-[A-Za-z0-9-]+$ ]] || return 2
    if [[ "$state" == running || "$state" == restarting || "$state" == paused ]]; then say "Restic container $name from an earlier run is still $state"; return 3; fi
    timeout "$cleanup_timeout" docker rm -f "$name" >>"$run_log" 2>&1 8>&- || return 2
    say "removed leftover Restic container $name"
  done <<<"${listing//$'\r'/}"
}

# Removes this run's Restic containers that outlived their clients.
reap_run_containers() {
  local names name
  names="$(timeout "$cleanup_timeout" docker ps -a -q --filter "label=com.mawareeth.backup-run=$run_token" 2>>"$run_log" 8>&-)" || return 1
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    timeout "$cleanup_timeout" docker rm -f "$name" >>"$run_log" 2>&1 8>&- || return 1
  done <<<"${names//$'\r'/}"
}

# Python helpers over `restic snapshots --json` and `restic stats --json`.
# Exit 2: unparseable input; 3: nothing found; 4: a duplicate or missing pair.
snapshot_py='
import json, re, sys
from datetime import datetime

def epoch(value):
    match = re.match(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)$", value)
    if not match:
        raise ValueError(value)
    zone = "+00:00" if match.group(2) == "Z" else match.group(2)
    return int(datetime.fromisoformat(match.group(1) + zone).timestamp())

def path_of(snapshot):
    paths = snapshot.get("paths") or []
    return paths[0].lstrip("/") if len(paths) == 1 else None

def run_of(snapshot):
    runs = [tag[4:] for tag in snapshot.get("tags") or [] if tag.startswith("run:")]
    return runs[0] if len(runs) == 1 else None

# The pg-major:<N> tag value of a dump: empty for dumps taken before it was
# recorded, "invalid" for a duplicate tag or one that does not match
# pattern (major_re, passed to "latest" as argv[5]).
def major_of(snapshot, pattern):
    majors = [tag[9:] for tag in snapshot.get("tags") or [] if tag.startswith("pg-major:")]
    if not majors:
        return ""
    return majors[0] if len(majors) == 1 and re.fullmatch(pattern, majors[0]) else "invalid"

try:
    value = json.loads(sys.stdin.read() or "null")
    action = sys.argv[1]
    if action == "size":
        size = value["total_size"]
        if not isinstance(size, int) or size < 0:
            raise ValueError("size")
        print(size)
        raise SystemExit(0)
    if not isinstance(value, list):
        raise ValueError("not a list")
    snapshots = value
    if action == "ids":
        for snapshot in snapshots:
            if not re.match(r"^[0-9a-zA-Z]+$", snapshot["id"]):
                raise ValueError("id")
            print(snapshot["id"])
    elif action == "one":
        found = [s["id"] for s in snapshots if path_of(s) == sys.argv[2]]
        if len(found) != 1:
            raise SystemExit(4 if found else 3)
        print(found[0])
    elif action == "latest":
        dumps = [s for s in snapshots if path_of(s) == sys.argv[2] and s.get("hostname") == sys.argv[4] and run_of(s)]
        if not dumps:
            raise SystemExit(3)
        for dump in sorted(dumps, key=lambda s: epoch(s["time"]), reverse=True):
            run = run_of(dump)
            manifests = [s["id"] for s in snapshots if path_of(s) == sys.argv[3] and run_of(s) == run]
            if len(manifests) == 1:
                print("\t".join([dump["id"], manifests[0], run, str(epoch(dump["time"])), dump["time"], major_of(dump, sys.argv[5])]))
                raise SystemExit(0)
            print("run %s has %d manifests" % (run, len(manifests)), file=sys.stderr)
        raise SystemExit(4)
    else:
        raise SystemExit(2)
except (KeyError, TypeError, ValueError):
    raise SystemExit(2)
'

# --- backup --------------------------------------------------------------------

# globals_role_passwords is recorded only for an ok run: a failed run's
# globals snapshot is discarded, so it records the field empty.
write_backup_status() {
  local content passwords=''
  [[ "$1" != ok ]] || passwords="$globals_role_passwords"
  content="result=$1
run=$run_token
finished_at=$(now_iso)
finished_epoch=$(now_epoch)
dump_snapshot=$dump_id
manifest_snapshot=$manifest_id
host_state_snapshot=$host_state_id
globals_snapshot=$globals_id
pg_major=$pg_major
globals_role_passwords=$passwords
log=$run_log"
  if ! atomic_write "$status_file" 0600 "$content"; then say "could not write $status_file"; return 1; fi
  outcome_written=1
}

close_psql() {
  if [[ -n "$psql_in" ]]; then
    exec {psql_in}>&-
    psql_in=''
  fi
}

# forget_matching FILTER LIMIT forgets every snapshot whose tags include all
# of FILTER's comma-separated tags.
forget_matching() {
  local json ids
  json="$(restic_run "$2" snapshots --json --host "$restic_host" --tag "$1")" || return 1
  ids="$(python3 -I -c "$snapshot_py" ids <<<"$json")" || return 1
  ids="${ids//$'\r'/}"
  [[ -n "$ids" ]] || return 0
  local -a list
  mapfile -t list <<<"$ids"
  restic_run "$2" forget "${list[@]}" >>"$run_log"
}

# discard_run forgets every snapshot of this run, whatever its tags, so a
# failed or interrupted run never leaves a pending or orphan complete dump.
discard_run() {
  case "$stage" in
    setup|repository|postgres|retention) return 0 ;;
  esac
  if ! forget_matching "run:$run_token" "$forget_timeout"; then
    say 'could not forget this run'"'"'s snapshots; the next backup forgets pending ones'
  fi
}

# backup_fail STAGE MESSAGE: discard this run's snapshots, record the
# failure, and exit 5. Restic diagnostics stay in the root-only run log.
backup_fail() {
  local failed_stage="$1"; shift
  trap '' INT TERM HUP
  close_psql
  stage="$failed_stage"
  say "$* (stage $failed_stage); details in $run_log"
  discard_run
  if ! reap_run_containers; then say 'could not remove this run'"'"'s Restic containers'; fi
  write_backup_status "failed:$failed_stage" || exit 5
  exit 5
}

find_postgres() {
  local ids
  ids="$(timeout "$cleanup_timeout" docker ps --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=postgres --format '{{.ID}}' 2>>"$run_log" 8>&-)" \
    || backup_fail postgres 'cannot list running containers'
  ids="${ids//$'\r'/}"
  [[ -n "$ids" ]] || backup_fail postgres 'no running mawareeth PostgreSQL container was found'
  [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] || backup_fail postgres 'expected exactly one running mawareeth PostgreSQL container, found several'
  pg_container="$ids"
}

ensure_cache_volume() {
  if ! volume_exists "$cache_volume"; then
    docker volume create --label com.mawareeth.owner=mawareeth --label com.mawareeth.role=restic-cache "$cache_volume" >>"$run_log" 2>&1 8>&- \
      || die "could not create volume $cache_volume"
  fi
  validate_existing_volume "$cache_volume" restic-cache
}

# dump_and_count holds one REPEATABLE READ transaction in a psql coprocess:
# it exports the snapshot, reads the server major and whether the backup role
# is a superuser, applies the output
# settings, counts and checksums every user table inside the snapshot, then
# streams pg_dump --snapshot straight into Restic (tagged pg-major:<N>), so
# the manifest and the dump describe the same data. Nothing unencrypted
# touches the host disk. The coprocess limit covers counting plus the whole
# dump; psql and pg_dump also run under `timeout` inside the container so
# server-side work stops with them.
dump_and_count() {
  local psql_out snapshot_id version line remaining deadline status coproc_in coproc_out psql_limit dump_limit
  local -a pipe
  cap "$backup_budget"; psql_limit=$((cap_value + coproc_grace))
  coproc PSQL { exec timeout --kill-after=10 "$((psql_limit + 30))" docker exec -i "$pg_container" \
    timeout "$psql_limit" psql -X -q -A -t -F "$tab" -v ON_ERROR_STOP=1 -U "$pg_user" -d "$pg_db" 2>>"$run_log" 8>&-; }
  psql_pid="${PSQL_PID:-}"; coproc_in="${PSQL[1]:-}"; coproc_out="${PSQL[0]:-}"
  [[ -n "$psql_pid" && -n "$coproc_in" && -n "$coproc_out" ]] || backup_fail dump 'psql exited immediately'
  # Private copies survive Bash closing the coprocess descriptors when psql
  # exits; the originals are closed so COMMIT plus EOF ends the session.
  exec {psql_in}>&"$coproc_in" {psql_out}<&"$coproc_out"
  exec {coproc_in}>&- {coproc_out}<&-
  printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ;' 'SELECT pg_export_snapshot();' 1>&"$psql_in" 2>>"$run_log" \
    || backup_fail dump 'PostgreSQL did not accept the snapshot transaction'
  IFS= read -r -t "$read_timeout" -u "$psql_out" snapshot_id || backup_fail dump 'PostgreSQL did not export a snapshot'
  snapshot_id="${snapshot_id%$'\r'}"
  [[ "$snapshot_id" =~ ^[0-9A-Fa-f]+-[0-9A-Fa-f]+(-[0-9]+)?$ ]] || backup_fail dump 'PostgreSQL returned an invalid snapshot identifier'

  printf '%s\n' 'SHOW server_version_num;' 1>&"$psql_in" 2>>"$run_log" || backup_fail dump 'PostgreSQL did not accept the version query'
  IFS= read -r -t "$read_timeout" -u "$psql_out" version || backup_fail dump 'PostgreSQL did not report its version'
  version="${version%$'\r'}"
  pg_major_of "$version" pg_major || backup_fail dump 'PostgreSQL returned an invalid server_version_num'

  # Only a superuser can read role password hashes for the globals.
  printf '%s\n' 'SHOW is_superuser;' 1>&"$psql_in" 2>>"$run_log" || backup_fail dump 'PostgreSQL did not accept the superuser query'
  IFS= read -r -t "$read_timeout" -u "$psql_out" pg_superuser || backup_fail dump 'PostgreSQL did not report whether the backup role is a superuser'
  pg_superuser="${pg_superuser%$'\r'}"
  [[ "$pg_superuser" == on || "$pg_superuser" == off ]] || backup_fail dump 'PostgreSQL returned an invalid is_superuser value'

  printf '%s\n' "$output_settings_sql" "$count_sql" "SELECT '$counts_end';" 1>&"$psql_in" 2>>"$run_log" || backup_fail dump 'PostgreSQL did not accept the count query'
  manifest=''
  cap "$backup_timeout"; deadline=$((SECONDS + cap_value))
  while :; do
    remaining=$((deadline - SECONDS))
    ((remaining > 0)) || backup_fail dump 'counting rows timed out'
    IFS= read -r -t "$remaining" -u "$psql_out" line || backup_fail dump 'PostgreSQL stopped while counting rows'
    line="${line%$'\r'}"
    [[ "$line" != "$counts_end" ]] || break
    [[ "$line" =~ $count_line_re ]] || backup_fail dump 'PostgreSQL returned a malformed row count or checksum'
    manifest+="$line"$'\n'
  done
  stage=manifest
  [[ -n "$manifest" ]] || backup_fail manifest 'the database has no user tables'
  [[ $'\n'"$manifest" == *$'\n'"$migrations_key"$'\t'* ]] || backup_fail manifest "the row-count manifest lacks $migrations_key"

  stage=dump
  cap "$backup_timeout"; dump_limit="$cap_value"
  set +e
  timeout --kill-after=10 "$((dump_limit + 30))" docker exec "$pg_container" timeout "$dump_limit" pg_dump -Fc "--snapshot=$snapshot_id" -U "$pg_user" -d "$pg_db" 2>>"$run_log" 8>&- \
    | restic_in "$((dump_limit + 30))" backup --stdin --stdin-filename "$dump_name" --host "$restic_host" --tag "pending,run:$run_token,pg-major:$pg_major" --quiet >>"$run_log"
  pipe=("${PIPESTATUS[@]}")
  set -e
  [[ "${pipe[0]}" == 0 ]] || backup_fail dump "pg_dump failed (status ${pipe[0]})"
  [[ "${pipe[1]}" == 0 ]] || backup_fail dump "storing the dump in the repository failed (status ${pipe[1]})"

  printf '%s\n' 'COMMIT;' 1>&"$psql_in" 2>>"$run_log" || backup_fail dump 'PostgreSQL did not accept COMMIT'
  close_psql
  status=0
  wait "$psql_pid" || status=$?
  exec {psql_out}<&-
  [[ "$status" == 0 ]] || backup_fail dump "the snapshot transaction failed (status $status)"
}

# collect_host_state_paths sets host_state_paths[] to the archive's members,
# relative to /, archived without recursion: the runtime file, the routes
# directory and its route file, the slots directory (when present) with each
# blue or green record and .prev, and each runtime snapshot a record names.
# Stray files (e.g. .tmp.*) are left out. Everything is only read.
collect_host_state_paths() {
  local slot suffix status snapshot path record
  local -A seen=()
  local -a paths=("$runtime_file" "$routes_dir" "$route_file")
  [[ -f "$runtime_file" && ! -L "$runtime_file" ]] || backup_fail host-state "the runtime file $runtime_file is missing or not a regular file"
  [[ -d "$routes_dir" && ! -L "$routes_dir" ]] || backup_fail host-state "the routes directory $routes_dir is missing or not a directory"
  [[ -f "$route_file" && ! -L "$route_file" ]] || backup_fail host-state "the route file $route_file is missing or not a regular file"
  if [[ -e "$slots_dir" || -L "$slots_dir" ]]; then
    [[ -d "$slots_dir" && ! -L "$slots_dir" ]] || backup_fail host-state "$slots_dir is not a directory"
    paths+=("$slots_dir")
    for slot in blue green; do
      for suffix in '' .prev; do
        record="$slots_dir/$slot.env$suffix"
        # A command substitution, because read_slot_record dies on an
        # unusable record: 1 means the record is absent.
        status=0
        snapshot="$(read_slot_record "$slot" "$suffix" 2>>"$run_log" && printf '%s\n' "$SLOT_SNAPSHOT")" || status=$?
        case "$status" in
          0) ;;
          1) continue ;;
          *) backup_fail host-state "the $slot.env$suffix slot record is unusable" ;;
        esac
        paths+=("$record")
        path="$state_dir/${snapshot//$'\r'/}"
        [[ -f "$path" && ! -L "$path" ]] || backup_fail host-state "the runtime snapshot named by the $slot.env$suffix slot record is missing"
        if [[ -z "${seen[$path]:-}" ]]; then seen[$path]=1; paths+=("$path"); fi
      done
    done
  fi
  for path in "${paths[@]}"; do
    [[ "$path" == /?* && "$path" != *$'\n'* ]] || backup_fail host-state 'a host-state path is not absolute'
  done
  host_state_paths=("${paths[@]#/}")
}

# store_host_state streams the host-state archive straight into Restic, so
# nothing unencrypted touches the disk. It is taken without the deploy lock:
# a point-in-time copy of atomically written files.
store_host_state() {
  local -a pipe host_state_paths=()
  collect_host_state_paths
  cap "$repo_timeout"
  set +e
  tar --numeric-owner --no-recursion -cf - -C / "${host_state_paths[@]}" 2>>"$run_log" \
    | restic_in "$cap_value" backup --stdin --stdin-filename "$host_state_name" --host "$restic_host" --tag "pending,run:$run_token" --quiet >>"$run_log"
  pipe=("${PIPESTATUS[@]}")
  set -e
  # Restic first: a storage failure can also kill tar with SIGPIPE.
  [[ "${pipe[1]}" == 0 ]] || backup_fail host-state "storing the host state in the repository failed (status ${pipe[1]})"
  [[ "${pipe[0]}" == 0 ]] || backup_fail host-state "archiving the host state failed (status ${pipe[0]})"
}

# store_globals streams `pg_dumpall --globals-only` (roles, role settings,
# tablespaces) straight into Restic as globals.sql, so the role password
# hashes never touch the host disk. It is stored for a manual recovery only;
# nothing restores it automatically. A role that is not a superuser cannot
# read pg_authid, so its globals are taken with --no-role-passwords. Once
# they are stored, globals_role_passwords is set (1 with the hashes, 0
# without); last-backup records it only for an ok run, empty otherwise.
store_globals() {
  local -a pipe extra=()
  if [[ "$pg_superuser" != on ]]; then
    extra=(--no-role-passwords)
    say "the backup role $pg_user is not a superuser, so the cluster globals are stored without role password hashes (--no-role-passwords)"
  fi
  cap "$repo_timeout"
  set +e
  timeout --kill-after=10 "$((cap_value + 30))" docker exec "$pg_container" timeout "$cap_value" pg_dumpall --globals-only -U "$pg_user" -l "$pg_db" "${extra[@]}" 2>>"$run_log" 8>&- \
    | restic_in "$((cap_value + 30))" backup --stdin --stdin-filename "$globals_name" --host "$restic_host" --tag "pending,run:$run_token" --quiet >>"$run_log"
  pipe=("${PIPESTATUS[@]}")
  set -e
  # Restic first: a storage failure can also kill pg_dumpall's client.
  [[ "${pipe[1]}" == 0 ]] || backup_fail globals "storing the cluster globals in the repository failed (status ${pipe[1]})"
  [[ "${pipe[0]}" == 0 ]] || backup_fail globals "pg_dumpall --globals-only failed (status ${pipe[0]})"
  if [[ "$pg_superuser" == on ]]; then globals_role_passwords=1; else globals_role_passwords=0; fi
}

# run_ids FILTER sets dump_id, manifest_id, globals_id, and host_state_id from
# this run's snapshots.
run_ids() {
  local json
  cap "$repo_timeout"
  json="$(restic_run "$cap_value" snapshots --json --host "$restic_host" --tag "$1")" || return 1
  dump_id="$(python3 -I -c "$snapshot_py" one "$dump_name" <<<"$json")" || return 1
  manifest_id="$(python3 -I -c "$snapshot_py" one "$manifest_name" <<<"$json")" || return 1
  globals_id="$(python3 -I -c "$snapshot_py" one "$globals_name" <<<"$json")" || return 1
  host_state_id="$(python3 -I -c "$snapshot_py" one "$host_state_name" <<<"$json")" || return 1
  dump_id="${dump_id//$'\r'/}"; manifest_id="${manifest_id//$'\r'/}"; globals_id="${globals_id//$'\r'/}"; host_state_id="${host_state_id//$'\r'/}"
}

cmd_backup() {
  local magic members globals sweep=0
  load_backup_config
  acquire_backup_lock
  open_run_log backup
  mode=backup
  run_deadline=$(( $(now_epoch) + backup_budget ))
  stage=setup
  ensure_cache_volume
  sweep_restic_containers || sweep=$?
  ((sweep == 0)) || backup_fail setup 'leftover Restic containers could not be cleared'
  say "backup run $run_stamp started"

  stage=repository
  cap "$repo_timeout"
  restic_run "$cap_value" unlock >>"$run_log" || backup_fail repository 'the repository is unreachable or rejected the connection'
  cap "$repo_timeout"
  forget_matching pending "$cap_value" || backup_fail repository 'could not forget stale pending snapshots'

  stage=postgres
  find_postgres

  stage=dump
  dump_and_count

  stage=manifest
  cap "$repo_timeout"
  printf '%s' "$manifest" | restic_in "$cap_value" backup --stdin --stdin-filename "$manifest_name" --host "$restic_host" --tag "pending,run:$run_token" --quiet >>"$run_log" \
    || backup_fail manifest 'storing the row-count manifest failed'

  stage=globals
  store_globals

  stage=host-state
  store_host_state

  stage=verify
  run_ids "pending,run:$run_token" || backup_fail verify 'this run does not have exactly one dump, manifest, globals, and host-state snapshot'
  # Draining the whole dump (not just its first bytes) is deliberate: it reads
  # and decrypts every blob of this snapshot from the Storage Box nightly.
  cap "$repo_timeout"
  magic="$(restic_run "$cap_value" dump "$dump_id" "/$dump_name" | { head -c 5; cat > /dev/null; })" || backup_fail verify 'reading the stored dump back failed'
  [[ "$magic" == PGDMP ]] || backup_fail verify 'the stored dump is not a PostgreSQL custom-format archive'
  cap "$repo_timeout"
  # The host-state archive must read back and hold the runtime file.
  members="$(restic_run "$cap_value" dump "$host_state_id" "/$host_state_name" | tar -tf - 2>>"$run_log")" \
    || backup_fail verify 'the stored host-state archive is unreadable or lacks the runtime file'
  grep -Fxq -- "${runtime_file#/}" <<<"${members//$'\r'/}" || backup_fail verify 'the stored host-state archive is unreadable or lacks the runtime file'
  cap "$repo_timeout"
  # The globals must read back as a pg_dumpall cluster dump. They hold role
  # password hashes, so they are matched in memory (no here-string, which may
  # use a temporary file).
  globals="$(restic_run "$cap_value" dump "$globals_id" "/$globals_name")" || backup_fail verify 'the stored cluster globals are unreadable'
  [[ $'\n'"${globals//$'\r'/}"$'\n' == *$'\n'"$globals_header"$'\n'* ]] || backup_fail verify 'the stored cluster globals are not a pg_dumpall cluster dump'
  globals=''

  stage=tag
  cap "$repo_timeout"
  restic_run "$cap_value" tag --add complete --remove pending "$dump_id" "$manifest_id" "$globals_id" "$host_state_id" >>"$run_log" || backup_fail tag 'tagging the run complete failed'
  # `restic tag` rewrites snapshots under new IDs; record the current ones.
  run_ids "complete,run:$run_token" || backup_fail tag 'the run does not have exactly one complete dump, manifest, globals, and host-state snapshot after tagging'

  stage=retention
  cap "$repo_timeout"
  restic_run "$cap_value" forget --host "$restic_host" --tag complete "${retention[@]}" --prune >>"$run_log" \
    || backup_fail retention 'applying retention failed'

  write_backup_status ok || exit 5
  say "backup run $run_stamp complete: $(grep -c . <<<"$manifest") tables counted and checksummed, PostgreSQL $pg_major"
}

# --- verify-restore ------------------------------------------------------------

write_evidence() {
  local content
  content="result=$1
verified_at=$(now_iso)
verified_epoch=$(now_epoch)
backup_run=${2:-}
dump_snapshot=$dump_id
manifest_snapshot=$manifest_id
dump_time=${3:-}
dump_age_seconds=${4:-}
duration_seconds=${5:-}
restore_seconds=$restore_seconds
tables=${6:-}
content_checksums=$content_checksums
dump_pg_major=$dump_pg_major
restore_pg_major=$restore_pg_major
rpo_seconds=$rpo_seconds
rto_seconds=$rto_seconds
log=$run_log"
  if ! atomic_write "$evidence_file" 0600 "$content"; then say "could not write $evidence_file"; return 1; fi
  outcome_written=1
}

# cleanup_restore removes the throwaway container and volume; returns 1 when
# either may remain.
cleanup_restore() {
  local result=0 present
  if [[ -n "$restore_container" ]]; then
    present=0; container_present "$restore_container" || present=$?
    if [[ "$present" == 0 ]]; then
      timeout "$cleanup_timeout" docker rm -f -v "$restore_container" >>"$run_log" 2>&1 8>&- || result=1
    elif [[ "$present" == 2 ]]; then result=1; fi
  fi
  if [[ -n "$restore_volume" ]]; then
    present=0; volume_present "$restore_volume" || present=$?
    if [[ "$present" == 0 ]]; then
      timeout "$cleanup_timeout" docker volume rm "$restore_volume" >>"$run_log" 2>&1 8>&- || result=1
    elif [[ "$present" == 2 ]]; then result=1; fi
  fi
  if [[ "$result" == 0 ]]; then restore_container=''; restore_volume=''; fi
  return "$result"
}

# restore_fail REASON MESSAGE [EVIDENCE...]: remove the throwaway database,
# record fail:REASON, and exit 6.
restore_fail() {
  local reason="$1" message="$2"; shift 2
  trap '' INT TERM HUP
  say "restore verification failed: $message; details in $run_log"
  if ! cleanup_restore; then say 'CRITICAL: the throwaway restore container or volume could not be removed; remove it manually'; fi
  if ! reap_run_containers; then say 'could not remove this run'"'"'s Restic containers'; fi
  write_evidence "fail:$reason" "$@" || exit 6
  exit 6
}

wait_restore_ready() {
  local deadline pause
  cap "$start_timeout"; deadline=$((SECONDS + cap_value))
  while :; do
    if timeout 30 docker exec "$restore_container" pg_isready -h 127.0.0.1 -p 5432 -U "$pg_user" -d "$pg_db" >>"$run_log" 2>&1 8>&-; then return 0; fi
    ((SECONDS < deadline)) || return 1
    pause="$poll_interval"
    ((deadline - SECONDS >= pause)) || pause=$((deadline - SECONDS))
    ((pause < 1)) || sleep "$pause"
  done
}

# free_bytes prints the space available on Docker's data root.
free_bytes() {
  local root_dir available
  root_dir="$(timeout 30 docker info --format '{{.DockerRootDir}}' 2>>"$run_log" 8>&-)" || return 1
  root_dir="${root_dir//$'\r'/}"
  [[ "$root_dir" == /* && "$root_dir" != *$'\n'* ]] || return 1
  available="$(df -B1 --output=avail "$root_dir" 2>>"$run_log" | tail -n 1)" || return 1
  available="${available//[[:space:]]/}"
  [[ "$available" =~ ^[0-9]{1,20}$ ]] || return 1
  printf '%s\n' "$available"
}

cmd_verify_restore() {
  local json latest run_tag dump_epoch dump_time age stored restored password limit tables duration line
  local helper=0 present=0 size available sweep=0 version query
  local -a pipe
  load_backup_config
  validate_image "${locked[POSTGRES_IMAGE]}"
  acquire_backup_lock
  open_run_log restore
  mode=restore
  restore_started="$(now_epoch)"
  run_deadline=$((restore_started + rto_seconds))
  stage=setup
  ensure_cache_volume
  sweep_restic_containers || sweep=$?
  ((sweep == 0)) || restore_fail setup 'leftover Restic containers could not be cleared'
  say "restore verification $run_stamp started"

  stage=repository
  cap "$repo_timeout"
  restic_run "$cap_value" unlock >>"$run_log" || restore_fail repository 'the repository is unreachable or rejected the connection'
  cap "$repo_timeout"
  restic_run "$cap_value" check >>"$run_log" || restore_fail repository 'restic check reported a repository problem'
  cap "$repo_timeout"
  json="$(restic_run "$cap_value" snapshots --json --host "$restic_host" --tag complete)" || restore_fail repository 'could not list complete snapshots'
  latest="$(python3 -I -c "$snapshot_py" latest "$dump_name" "$manifest_name" "$restic_host" "$major_re" <<<"$json" 2>>"$run_log")" || helper=$?
  case "$helper" in
    0) ;;
    3) restore_fail no-backup 'no complete dump exists' ;;
    4) restore_fail manifest 'no complete dump has exactly one matching manifest' ;;
    *) restore_fail repository 'the snapshot listing could not be parsed' ;;
  esac
  latest="${latest//$'\r'/}"
  IFS="$tab" read -r dump_id manifest_id run_tag dump_epoch dump_time dump_pg_major <<<"$latest"
  age=$((restore_started - dump_epoch))
  ((age >= -clock_skew_seconds)) || restore_fail stale "the latest dump is dated ${age#-}s in the future (clock skew)" "$run_tag" "$dump_time" "$age"
  ((age <= rpo_seconds)) || restore_fail stale "the latest complete dump is ${age}s old (RPO ${rpo_seconds}s)" "$run_tag" "$dump_time" "$age"
  [[ -z "$dump_pg_major" || "$dump_pg_major" =~ $major_re ]] \
    || restore_fail version-mismatch 'the dump has a duplicate or malformed pg-major tag' "$run_tag" "$dump_time" "$age"

  stage=manifest
  cap "$repo_timeout"
  stored="$(restic_run "$cap_value" dump "$manifest_id" "/$manifest_name")" || restore_fail repository 'could not read the manifest' "$run_tag" "$dump_time" "$age"
  stored="${stored//$'\r'/}"
  [[ -n "$stored" ]] || restore_fail manifest 'the stored manifest is empty' "$run_tag" "$dump_time" "$age"
  # Every line has a checksum, or (a manifest from before checksums) none does.
  # content_checksums takes the first line's kind; a refused manifest records
  # it empty, since nothing was compared.
  while IFS= read -r line; do
    if [[ "$line" =~ $count_line_re ]]; then
      [[ "$content_checksums" != 0 ]] || { content_checksums=''; restore_fail manifest 'the stored manifest mixes counts-only and checksum lines' "$run_tag" "$dump_time" "$age"; }
      content_checksums=1
    elif [[ "$line" =~ $legacy_count_line_re ]]; then
      [[ "$content_checksums" != 1 ]] || { content_checksums=''; restore_fail manifest 'the stored manifest mixes counts-only and checksum lines' "$run_tag" "$dump_time" "$age"; }
      content_checksums=0
    else
      content_checksums=''; restore_fail manifest 'the stored manifest is malformed' "$run_tag" "$dump_time" "$age"
    fi
  done <<<"$stored"
  # Only a legacy (counts-only) run may lack the tag: a checksum run's dump
  # always carries it, so its absence is a regression, not an old backup.
  if [[ "$content_checksums" == 1 && -z "$dump_pg_major" ]]; then
    restore_fail version-mismatch "a checksum run's dump lacks its pg-major tag" "$run_tag" "$dump_time" "$age"
  fi
  [[ $'\n'"$stored" == *$'\n'"$migrations_key"$'\t'* ]] \
    || restore_fail manifest "the manifest does not count $migrations_key" "$run_tag" "$dump_time" "$age"
  tables="$(grep -c . <<<"$stored")"

  stage=setup
  cap "$repo_timeout"
  json="$(restic_run "$cap_value" stats --json --mode restore-size "$dump_id")" || restore_fail repository 'could not read the dump size' "$run_tag" "$dump_time" "$age"
  size="$(python3 -I -c "$snapshot_py" size <<<"$json")" || restore_fail repository 'the dump size could not be parsed' "$run_tag" "$dump_time" "$age"
  available="$(free_bytes)" || restore_fail setup 'cannot determine free space on the Docker data root' "$run_tag" "$dump_time" "$age"
  ((available >= disk_factor * size)) \
    || restore_fail setup "the Docker data root has $available bytes free; ${disk_factor}x the ${size}-byte dump is required" "$run_tag" "$dump_time" "$age"

  restore_container="mawareeth-restore-$run_token"
  restore_volume="mawareeth-restore-$run_token"
  present=0; volume_present "$restore_volume" || present=$?
  case "$present" in
    1) ;;
    0) restore_volume=''; restore_fail setup 'the throwaway restore volume already exists' "$run_tag" "$dump_time" "$age" ;;
    *) restore_volume=''; restore_fail setup 'cannot inspect Docker volumes' "$run_tag" "$dump_time" "$age" ;;
  esac
  timeout "$cleanup_timeout" docker volume create --label com.mawareeth.owner=mawareeth --label com.mawareeth.role=restore-check "$restore_volume" >>"$run_log" 2>&1 8>&- \
    || restore_fail setup 'could not create the throwaway restore volume' "$run_tag" "$dump_time" "$age"
  password="$(python3 -I -c 'import secrets; print(secrets.token_hex(24))')" || restore_fail setup 'could not generate a password'
  password="${password//$'\r'/}"
  POSTGRES_PASSWORD="$password" timeout 120 docker run -d --name "$restore_container" --network none \
    --label com.mawareeth.owner=mawareeth --label com.mawareeth.role=restore-check \
    -v "$restore_volume:/var/lib/postgresql/data" -e POSTGRES_PASSWORD -e "POSTGRES_USER=$pg_user" -e "POSTGRES_DB=$pg_db" \
    "${locked[POSTGRES_IMAGE]}" >>"$run_log" 2>&1 8>&- || restore_fail setup 'could not start the throwaway PostgreSQL' "$run_tag" "$dump_time" "$age"
  password=''
  wait_restore_ready || restore_fail setup 'the throwaway PostgreSQL did not become ready' "$run_tag" "$dump_time" "$age"

  # A dump is restored only into the PostgreSQL major it was taken from; a
  # legacy (counts-only) dump without a pg-major tag is restored as before.
  stage=version
  cap "$read_timeout"; limit="$cap_value"
  version="$(timeout --kill-after=10 "$((limit + 30))" docker exec -i "$restore_container" timeout "$limit" \
    psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$pg_user" -d "$pg_db" <<<'SHOW server_version_num;' 2>>"$run_log" 8>&-)" \
    || restore_fail setup 'could not read the throwaway PostgreSQL version' "$run_tag" "$dump_time" "$age"
  version="${version//$'\r'/}"
  pg_major_of "$version" restore_pg_major || restore_fail setup 'the throwaway PostgreSQL returned an invalid server_version_num' "$run_tag" "$dump_time" "$age"
  if [[ -n "$dump_pg_major" && "$dump_pg_major" != "$restore_pg_major" ]]; then
    restore_fail version-mismatch "the dump was taken from PostgreSQL ${dump_pg_major} but the throwaway server runs PostgreSQL $restore_pg_major" "$run_tag" "$dump_time" "$age"
  fi

  stage=restore
  cap "$rto_seconds"; limit="$cap_value"
  set +e
  restic_run "$limit" dump "$dump_id" "/$dump_name" \
    | timeout --kill-after=10 "$((limit + 30))" docker exec -i "$restore_container" timeout "$limit" \
        pg_restore --exit-on-error --no-owner --no-acl -U "$pg_user" -d "$pg_db" >>"$run_log" 2>&1 8>&-
  pipe=("${PIPESTATUS[@]}")
  set -e
  [[ "${pipe[0]}" == 0 ]] || restore_fail repository "reading the dump failed (status ${pipe[0]})" "$run_tag" "$dump_time" "$age"
  [[ "${pipe[1]}" == 0 ]] || restore_fail restore "pg_restore failed (status ${pipe[1]})" "$run_tag" "$dump_time" "$age"
  # The RTO still covers the whole run; this shows how much of it the restore
  # itself took, and so how much the count and checksum pass used.
  restore_seconds=$(( $(now_epoch) - restore_started ))

  stage=count
  cap "$rto_seconds"; limit="$cap_value"
  if [[ "$content_checksums" == 1 ]]; then query="$count_sql"; else query="$legacy_count_sql"; fi
  restored="$(timeout --kill-after=10 "$((limit + 30))" docker exec -i "$restore_container" timeout "$limit" \
    psql -X -q -A -t -F "$tab" -v ON_ERROR_STOP=1 -U "$pg_user" -d "$pg_db" <<<"$output_settings_sql"$'\n'"$query" 2>>"$run_log" 8>&-)" \
    || restore_fail count 'counting the restored rows failed' "$run_tag" "$dump_time" "$age"
  restored="${restored//$'\r'/}"
  # A difference in the key or count columns is a count mismatch; otherwise
  # a content checksum differs.
  if [[ "$restored" != "$stored" ]]; then
    if ! diff <(printf '%s\n' "$stored") <(printf '%s\n' "$restored") >>"$run_log" 2>&1; then say "the differing tables are listed in $run_log"; fi
    if [[ "$(cut -f1,2 <<<"$restored")" != "$(cut -f1,2 <<<"$stored")" ]]; then
      restore_fail count-mismatch 'restored row counts differ from the manifest' "$run_tag" "$dump_time" "$age" '' "$tables"
    fi
    restore_fail checksum-mismatch 'restored table contents differ from the manifest checksums' "$run_tag" "$dump_time" "$age" '' "$tables"
  fi

  stage=cleanup
  cleanup_restore || restore_fail cleanup 'the throwaway restore container or volume could not be removed' "$run_tag" "$dump_time" "$age"
  duration=$(( $(now_epoch) - restore_started ))
  ((duration <= rto_seconds)) || restore_fail slow "the restore took ${duration}s (RTO ${rto_seconds}s)" "$run_tag" "$dump_time" "$age" "$duration" "$tables"
  write_evidence pass "$run_tag" "$dump_time" "$age" "$duration" "$tables" || exit 6
  if [[ "$content_checksums" == 1 ]]; then
    say "restore verified: run $run_tag, $tables tables match on counts and content checksums, dump ${age}s old, ${duration}s"
  else
    say "restore verified: run $run_tag, $tables tables match on counts (a manifest without content checksums), dump ${age}s old, ${duration}s"
  fi
}

# --- init, gate, status, install ----------------------------------------------

cmd_init() {
  load_backup_config
  acquire_backup_lock
  open_run_log init
  mode=init
  ensure_cache_volume
  if ! restic_run "$repo_timeout" init >>"$run_log"; then
    say "repository initialisation failed (it may already exist, or the Storage Box is unreachable); details in $run_log"
    exit 5
  fi
  say 'repository initialised; escrow the Restic password now (deploy/README.md)'
}

# read_record FILE: strict KEY=VALUE status file into record[]; 1 if unusable.
read_record() {
  local file="$1" line
  declare -gA record=()
  [[ -f "$file" && ! -L "$file" ]] || return 1
  [[ "$(stat -c '%u:%g:%a' "$file" 2>/dev/null)" == 0:0:600 ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([a-z_]+)=([^[:cntrl:]]*)$ ]] || return 1
    record[${BASH_REMATCH[1]}]="${BASH_REMATCH[2]}"
  done < "$file"
}

# gate_check prints each unmet condition and returns 1 when any is unmet.
# Epochs must be plain decimal (no octal or arithmetic surprises).
gate_check() {
  local now age
  local -a unmet=()
  now="$(now_epoch)"
  [[ "$now" =~ ^[1-9][0-9]{0,11}$ ]] || { say 'gate unmet: the system clock is unreadable'; return 1; }
  if read_record "$evidence_file"; then
    if [[ "${record[result]:-}" != pass ]]; then
      unmet+=("the latest restore verification result is ${record[result]:-missing}, not pass")
    elif [[ ! "${record[verified_epoch]:-}" =~ ^[1-9][0-9]{0,11}$ ]]; then
      unmet+=('the restore evidence has no valid verification time (verified_epoch)')
    else
      age=$((now - 10#${record[verified_epoch]}))
      ((age >= -clock_skew_seconds && age <= evidence_max_age)) || unmet+=("the passing restore evidence is ${age}s old (limit 35 days)")
    fi
  else
    unmet+=("no readable root-only restore evidence at $evidence_file; run verify-restore")
  fi
  if read_record "$status_file"; then
    if [[ "${record[result]:-}" != ok ]]; then
      unmet+=("the last backup result is ${record[result]:-missing}, not ok")
    elif [[ ! "${record[finished_epoch]:-}" =~ ^[1-9][0-9]{0,11}$ ]]; then
      unmet+=('the last backup status has no valid finish time (finished_epoch)')
    else
      age=$((now - 10#${record[finished_epoch]}))
      ((age >= -clock_skew_seconds && age <= backup_max_age)) || unmet+=("the last successful backup is ${age}s old (limit 26h)")
    fi
  else
    unmet+=("no readable root-only backup status at $status_file; run backup")
  fi
  local item
  for item in "${unmet[@]}"; do say "gate unmet: $item"; done
  ((${#unmet[@]} == 0))
}

cmd_gate() {
  [[ ${EUID:-999} -eq 0 ]] || die 'must run as root'
  if gate_check; then say 'gate passed: a verified restore and a recent successful backup exist'; return 0; fi
  exit 1
}

cmd_status() {
  [[ ${EUID:-999} -eq 0 ]] || die 'must run as root'
  local file
  for file in "$status_file" "$evidence_file"; do
    printf '== %s\n' "$file"
    if read_record "$file"; then cat -- "$file"; else printf '(absent or unreadable)\n'; fi
  done
  printf '== gate\n'
  if gate_check; then printf 'passed\n'; else printf 'unmet\n'; fi
}

# unit_service DESCRIPTION COMMAND [EXTRA-UNIT [EXTRA-SERVICE]]
unit_service() {
  printf '[Unit]\nDescription=%s\nWants=network-online.target\nAfter=network-online.target docker.service\nRequires=docker.service\n' "$1"
  [[ -z "${3:-}" ]] || printf '%s\n' "$3"
  printf '[Service]\nType=oneshot\nEnvironment=HOME=/root\nEnvironment=MAWAREETH_RUNTIME_DIR=%s\nEnvironment=MAWAREETH_RUNTIME_FILE=%s\n' "$state_dir" "$runtime_file"
  printf 'Environment=MAWAREETH_RUNTIME_IMAGE_LOCK=%s\nEnvironment=MAWAREETH_BACKUP_CONFIG_DIR=%s\n' "$lock_file" "$config_dir"
  printf 'ExecStart=/bin/bash %s/backup.sh %s\nTimeoutStartSec=%s\nTimeoutStopSec=%s\n' "$deploy_dir" "$2" "$unit_start_timeout" "$unit_stop_timeout"
  printf 'Nice=10\nIOSchedulingClass=idle\nCPUSchedulingPolicy=batch\n'
  [[ -z "${4:-}" ]] || printf '%s\n' "$4"
}

unit_timer() {
  printf '[Unit]\nDescription=%s\n[Timer]\nOnCalendar=%s\n' "$1" "$2"
  [[ -z "$3" ]] || printf 'RandomizedDelaySec=%s\n' "$3"
  printf 'Persistent=true\nUnit=%s\n[Install]\nWantedBy=timers.target\n' "$4"
}

cmd_install() {
  [[ ${EUID:-999} -eq 0 ]] || die 'must run as root'
  require_command systemctl; require_command timeout; require_command mktemp; require_command sync
  clean_path "$deploy_dir" 'the deployment checkout'
  clean_path "$state_dir" MAWAREETH_RUNTIME_DIR
  clean_path "$runtime_file" MAWAREETH_RUNTIME_FILE
  clean_path "$lock_file" MAWAREETH_RUNTIME_IMAGE_LOCK
  clean_path "$config_dir" MAWAREETH_BACKUP_CONFIG_DIR
  clean_path "$systemd_dir" MAWAREETH_SYSTEMD_DIR
  [[ -d "$systemd_dir" && ! -L "$systemd_dir" ]] || die "$systemd_dir must be a directory"
  # A restore check blocked by a running backup (exit 3) or failed after a bad
  # night is retried hourly, about six times; refusals (exit 2) are not.
  local retry_unit=$'StartLimitIntervalSec=12h\nStartLimitBurst=7'
  local retry_service=$'Restart=on-failure\nRestartSec=1h\nRestartPreventExitStatus=2'
  atomic_write "$systemd_dir/mawareeth-backup.service" 0644 "$(unit_service 'Mawareeth encrypted PostgreSQL backup' backup)" || die 'could not write mawareeth-backup.service'
  atomic_write "$systemd_dir/mawareeth-backup.timer" 0644 "$(unit_timer 'Nightly Mawareeth encrypted backup' '*-*-* 02:30:00' 15m mawareeth-backup.service)" || die 'could not write mawareeth-backup.timer'
  atomic_write "$systemd_dir/mawareeth-restore-check.service" 0644 "$(unit_service 'Mawareeth isolated restore verification' verify-restore "$retry_unit" "$retry_service")" || die 'could not write mawareeth-restore-check.service'
  atomic_write "$systemd_dir/mawareeth-restore-check.timer" 0644 "$(unit_timer 'Monthly Mawareeth restore verification' '*-*-01 04:00:00' '' mawareeth-restore-check.service)" || die 'could not write mawareeth-restore-check.timer'
  timeout 60 systemctl daemon-reload || die 'systemctl daemon-reload failed'
  timeout 60 systemctl enable --now mawareeth-backup.timer mawareeth-restore-check.timer || die 'could not enable the backup timers'
  say 'installed mawareeth-backup.timer (daily 02:30) and mawareeth-restore-check.timer (monthly, 1st at 04:00)'
}

# --- process safety net -------------------------------------------------------

# Unexpected exits and signals after an operation started still record a
# failure, discard the run's snapshots, and remove the throwaway database.
on_exit() {
  local status=$?
  trap '' INT TERM HUP
  close_psql
  if [[ "$mode" == restore && -n "$restore_container$restore_volume" ]]; then
    if ! cleanup_restore; then say 'CRITICAL: the throwaway restore container or volume could not be removed; remove it manually'; fi
  fi
  if [[ "$outcome_written" == 0 && ( "$mode" == backup || "$mode" == restore ) ]]; then
    if ! reap_run_containers; then say 'could not remove this run'"'"'s Restic containers'; fi
  fi
  if [[ "$outcome_written" == 0 && "$mode" == backup ]]; then
    say "backup stopped unexpectedly (status $status) during $stage"
    discard_run
    if write_backup_status "failed:$stage"; then :; fi
    status=5
  elif [[ "$outcome_written" == 0 && "$mode" == restore ]]; then
    say "restore verification stopped unexpectedly (status $status) during $stage"
    # die (exit 2) is a refusal of the environment, not an interruption.
    if [[ "$status" == 2 ]]; then
      if write_evidence fail:setup; then :; fi
    elif write_evidence fail:interrupted; then :; fi
    status=6
  fi
  exit "$status"
}

main() {
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap '' PIPE
  trap on_exit EXIT
  case "${1:-}" in
    init) cmd_init ;;
    backup) cmd_backup ;;
    verify-restore) cmd_verify_restore ;;
    gate) cmd_gate ;;
    status) cmd_status ;;
    install) cmd_install ;;
    *) die 'usage: backup.sh {init|backup|verify-restore|gate|status|install}' ;;
  esac
}

# Sourced by deploy/monitor.sh for its record readers; dispatch only when
# executed directly.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
