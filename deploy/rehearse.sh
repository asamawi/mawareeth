#!/usr/bin/env bash
# Cutover rehearsal: Heroku data import, phase timing, capacity, and the gate.
#
#   sudo deploy/rehearse.sh import [--freeze-marked] [--extensions-created]
#                                 copy Heroku's public schema into the empty
#                                 private PostgreSQL in one transaction and
#                                 compare it with the source snapshot (counts,
#                                 checksums, and sequences)
#   sudo deploy/rehearse.sh mark PHASE
#                                 record a manual cutover phase: ttl-lowered,
#                                 freeze-start, validated, dns-switched,
#                                 dns-rolled-back, or rollback-point
#   python3 deploy/rehearsal.py loadgen --url https://HOST --expect-address IP \
#       --minutes 32 | ssh HOST sudo /path/to/deploy/rehearse.sh capacity [--minutes 30]
#                                 run both slots and sample the host while
#                                 the workstation load runs; the load
#                                 summary arrives on standard input
#   sudo deploy/rehearse.sh report
#                                 combine the import, capacity, and restore
#                                 evidence with the phase marks into a gate
#                                 verdict and the cutover path
#
# Exit codes: 0 success (report: the gate passed); 1 the gate is not met; 2
# refused before anything was written (invalid input, configuration, or
# state); 3 the deploy or backup lock is held; 4 the import or capacity run
# failed (evidence records fail:<stage>), or mark or report could not write
# its record; 129/130/143 a hangup, interrupt, or
# termination (an import or capacity run in progress records fail:interrupted
# and capacity still stops the slot it started).
#
# The Heroku credentials are libpq keys in a root-only file passed to the
# pinned PostgreSQL client image only with `docker run --env-file`: never on a
# command line, in a log, or in the evidence. Every source session is read
# only and forced to PGSSLMODE=require. Only the public schema is copied, and
# only into a database without user tables. capacity never changes the route;
# it starts the idle slot from its own slot record and stops it on every exit
# path. Evidence lives in <state dir>/rehearsal/ as 0600 key=value files.
rehearse_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/backup.sh
source "$rehearse_script_dir/backup.sh"

source_file="${MAWAREETH_HEROKU_SOURCE_FILE:-/etc/mawareeth/heroku-source.env}"
rehearsal_py="$rehearse_script_dir/rehearsal.py"
rehearsal_dir="$state_dir/rehearsal"
rehearsal_logs_dir="$rehearsal_dir/logs"
import_evidence="$rehearsal_dir/import"
capacity_evidence="$rehearsal_dir/capacity"
samples_file="$rehearsal_dir/capacity-samples.tsv"
report_file="$rehearsal_dir/report"
proc_dir="${MAWAREETH_REHEARSAL_PROC:-/proc}"
sample_interval="${MAWAREETH_REHEARSAL_SAMPLE_INTERVAL:-15}"
import_timeout="${MAWAREETH_REHEARSAL_IMPORT_TIMEOUT:-14400}"
load_wait="${MAWAREETH_REHEARSAL_LOAD_WAIT:-900}"
default_minutes=30
stop_seconds=35
# Story 0.10 budgets: the write freeze must end (validated) within 20 minutes
# and DNS must point at Hetzner within 30.
freeze_budget=1200
dns_budget=1800
# --freeze-marked accepts only an operator mark this recent and newer than any
# earlier import, so a mark left by a rehearsal is never reused.
freeze_mark_max_age=1800
# Capacity evidence must cover at least 30 minutes of measured samples.
capacity_min_seconds=1800
# One unbroken source session from the count pass to the end of the dump.
source_options='-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=0 -c statement_timeout=0'
user_namespace_sql="n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname !~ '^pg_(toast_)?temp_'"
# Relations, sequences, views, composite and other user types, and functions
# in every non-system namespace, except objects an extension owns.
target_objects_sql="SELECT (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE $user_namespace_sql AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c') AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass AND d.objid = c.oid AND d.deptype = 'e')) + (SELECT count(*) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace WHERE $user_namespace_sql AND t.typtype IN ('b', 'd', 'e', 'r', 'm') AND t.typcategory <> 'A' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass AND d.objid = t.oid AND d.deptype = 'e')) + (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE $user_namespace_sql AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND d.objid = p.oid AND d.deptype = 'e'));"
extensions_sql="SELECT coalesce(string_agg(format('%I', extname), ',' ORDER BY extname), '') FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql';"
large_objects_sql='SELECT count(*) FROM pg_catalog.pg_largeobject_metadata;'
# "<key><TAB>last_value<TAB>is_called" per public sequence, in a stable order.
sequences_sql="SELECT format('SELECT %L, last_value, is_called FROM %I.%I', format('%I.%I', schemaname, sequencename), schemaname, sequencename) FROM pg_catalog.pg_sequences WHERE schemaname = 'public' ORDER BY sequencename \\gexec"
sequence_line_re='^[^[:cntrl:]]+'$'\t''-?[0-9]+'$'\t''[tf]$'
sequences_end='mawareeth-sequences-end'
phases=(ttl-lowered freeze-start validated dns-switched dns-rolled-back rollback-point)
source_keys=(PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD)
epoch_re='^[1-9][0-9]{0,11}$'

rehearse_mode=''
slot_started=0
capacity_slot=''
sampler_pid=''
samples_tmp=''
load_reader_pid=''
load_tmp=''
# Seconds standard input may stay closed while the sampler still runs before
# capacity gives up: the load generator stopped or the workstation disconnected.
input_closed_grace=5
dump_end_file=''
started_epoch=0
source_major=''
tables=''
count_seconds=''
dump_seconds=''
restore_seconds=''
compare_seconds=''
analyze_seconds=''
extensions_created=0
freeze_mark=''
source_sequences=''
declare -gA capacity_fields=() load_fields=()

die() { printf 'rehearse: %s\n' "$*" >&2; exit 2; }
say() {
  if ! printf 'rehearse: %s\n' "$*" >&2 2>/dev/null; then :; fi
  if [[ "$run_log" != /dev/null ]]; then
    if ! printf '%s rehearse: %s\n' "$(now_iso)" "$*" >> "$run_log" 2>/dev/null; then :; fi
  fi
}
require_root() { [[ ${EUID:-999} -eq 0 ]] || die 'must run as root'; }
in_list() { local item="$1" candidate; shift; for candidate in "$@"; do [[ "$candidate" != "$item" ]] || return 0; done; return 1; }

# load_source_file validates the Heroku libpq file before anything contacts
# Heroku: root:root 0600, the strict raw KEY=VALUE format of runtime.env, and
# exactly the five libpq keys. Values are never printed.
load_source_file() {
  local line key value
  local -A seen=()
  safe_path "$source_file" MAWAREETH_HEROKU_SOURCE_FILE
  file_metadata "$source_file" 600 'Heroku source file'
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] || die 'Heroku source file contains a blank line'
    [[ "$line" != *$'\r'* && "$line" != *[[:space:]]* ]] || die 'Heroku source file contains whitespace'
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || die 'Heroku source file must contain raw KEY=VALUE lines'
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    in_list "$key" "${source_keys[@]}" || die "Heroku source file contains unsupported key: $key"
    [[ -z "${seen[$key]+x}" ]] || die "Heroku source file contains duplicate key: $key"
    [[ -n "$value" ]] || die "Heroku source value is empty: $key"
    [[ "$value" != *[$'\001'-$'\037'$'\177']* ]] || die "Heroku source value contains a control character: $key"
    case "$key" in
      PGHOST) validate_hostname "$value" PGHOST anycase ;;
      PGPORT) { [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] && ((value <= 65535)); } || die 'PGPORT must be a TCP port' ;;
      PGDATABASE|PGUSER) [[ "$value" =~ ^[A-Za-z0-9_]{1,63}$ ]] || die "$key must be 1-63 letters, digits, or underscores" ;;
    esac
    seen[$key]=1
  done < "$source_file"
  for key in "${source_keys[@]}"; do [[ -n "${seen[$key]:-}" ]] || die "Heroku source file is missing required key: $key"; done
}

open_rehearsal_dirs() {
  ensure_state_dir existing
  state_subdir "$rehearsal_dir" 700 create
  state_subdir "$rehearsal_logs_dir" 700 create
}

# open_rehearsal_log NAME: a fresh root-only diagnostic log for this run.
open_rehearsal_log() {
  local file
  run_stamp="$(date -u +%Y%m%dT%H%M%SZ)" || die 'cannot read the clock'
  run_token="$run_stamp-$$"
  file="$rehearsal_logs_dir/$1-$run_token.log"
  (set -C; : > "$file") 2>/dev/null || die "cannot create diagnostic log $file"
  chmod 0600 "$file" || die "cannot protect diagnostic log $file"
  run_log="$file"
}

lock_for_mutation() {
  local status=0
  if ! acquire_deploy_lock; then
    say "another deploy or runtime operation holds $deploy_lock_file; nothing was changed"
    exit 3
  fi
  journal_status || status=$?
  case "$status" in
    0) ;;
    1) die "$(journal_refusal 'is not idle')" ;;
    *) die "$(journal_refusal 'is unsafe or malformed')" ;;
  esac
}

# service_container SERVICE prints the running container ID of a Compose
# service of this project (empty when it is not running).
service_container() {
  local ids
  ids="$(timeout "$cleanup_timeout" docker ps -q --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$1" 2>>"$run_log" 8>&- 9>&-)" || die "cannot list running containers for $1"
  printf '%s' "${ids//$'\r'/}"
}

find_target() {
  local ids
  ids="$(service_container postgres)"
  [[ -n "$ids" ]] || die 'no running mawareeth PostgreSQL container was found; run deploy/runtime.sh up or prepare and start PostgreSQL first'
  [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] || die 'expected exactly one running mawareeth PostgreSQL container, found several'
  pg_container="$ids"
}

# target_psql SECONDS: run standard input as SQL in the private PostgreSQL.
target_psql() {
  timeout --kill-after=10 "$(($1 + 30))" docker exec -i "$pg_container" timeout "$1" \
    psql -X -q -A -t -F "$tab" -v ON_ERROR_STOP=1 -U "$pg_user" -d "$pg_db" 2>>"$run_log" 8>&- 9>&-
}

# source_container NAME SECONDS PROGRAM ARGS... runs a libpq client from the
# pinned PostgreSQL image against Heroku. The credentials reach it only
# through --env-file; the session is read only and TLS is required.
source_container() {
  local name="$1" limit="$2" interactive=()
  shift 2
  [[ "$1" != psql ]] || interactive=(-i)
  timeout --kill-after=10 "$((limit + 30))" docker run --rm "${interactive[@]}" --name "mawareeth-rehearsal-$run_token-$name" \
    --label com.mawareeth.owner=mawareeth --label com.mawareeth.role=rehearsal-source --label "com.mawareeth.rehearsal-run=$run_token" \
    --env-file "$source_file" -e PGSSLMODE=require -e PGCONNECT_TIMEOUT=30 -e PGAPPNAME=mawareeth-rehearsal \
    -e "PGOPTIONS=$source_options" \
    "${locked[POSTGRES_IMAGE]}" timeout "$limit" "$@" 2>>"$run_log" 8>&- 9>&-
}

# Removes this run's source containers that outlived their clients.
reap_source_containers() {
  local names name
  [[ -n "$run_token" ]] || return 0
  names="$(timeout "$cleanup_timeout" docker ps -a -q --filter "label=com.mawareeth.rehearsal-run=$run_token" 2>>"$run_log" 8>&- 9>&-)" || return 1
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    timeout "$cleanup_timeout" docker rm -f "$name" >>"$run_log" 2>&1 8>&- 9>&- || container_gone "$name" || return 1
  done <<<"${names//$'\r'/}"
}

# container_gone ID succeeds once the container no longer exists. A container
# run with --rm may already be removing itself ("removal ... already in
# progress"), which fails docker rm -f although nothing is left behind.
container_gone() {
  local attempt left
  for attempt in 1 2 3 4 5; do
    left="$(timeout "$cleanup_timeout" docker ps -a -q --filter "id=$1" 2>>"$run_log" 8>&- 9>&-)" || return 1
    [[ -n "${left//[[:space:]]/}" ]] || return 0
    ((attempt == 5)) || sleep 1
  done
  return 1
}

# --- import --------------------------------------------------------------------

write_import_evidence() {
  local finished
  finished="$(now_epoch)"
  atomic_write "$import_evidence" 0600 "result=$1
started_at=$(date -u -d "@$started_epoch" +%Y-%m-%dT%H:%M:%SZ)
started_epoch=$started_epoch
finished_at=$(now_iso)
finished_epoch=$finished
source_pg_major=$source_major
tables=$tables
count_seconds=$count_seconds
dump_seconds=$dump_seconds
restore_seconds=$restore_seconds
compare_seconds=$compare_seconds
analyze_seconds=$analyze_seconds
total_seconds=$((finished - started_epoch))
freeze_start=$freeze_mark
log=$run_log" || { say "could not write $import_evidence"; return 1; }
  outcome_written=1
}

# import_fail STAGE MESSAGE: record fail:STAGE and exit 4.
import_fail() {
  trap '' INT TERM HUP
  close_psql
  say "import failed: $2 (stage $1); details in $run_log"
  if ! reap_source_containers; then say "could not remove this run's source containers; remove them with docker rm -f"; fi
  write_import_evidence "fail:$1" || exit 4
  exit 4
}

write_mark() {
  atomic_write "$rehearsal_dir/mark-$1" 0600 "phase=$1
epoch=$2
at=$(date -u -d "@$2" +%Y-%m-%dT%H:%M:%SZ)"
}

# target_missing_extensions LIST prints the comma-separated extensions of LIST
# that the private PostgreSQL lacks.
target_missing_extensions() {
  local present name out=''
  present="$(target_psql "$read_timeout" <<<"$extensions_sql")" || return 1
  present=",${present//$'\r'/},"
  local IFS=,
  for name in $1; do [[ "$present" == *",$name,"* ]] || out+="${out:+,}$name"; done
  printf '%s' "$out"
}

# read_source_sequences reads every public sequence's state in the snapshot
# session. Sequences are not transactional: the read follows the dump closely,
# and only a write freeze makes it exact.
read_source_sequences() {
  local line remaining deadline
  printf '%s\n' "$sequences_sql" "SELECT '$sequences_end';" 1>&"$psql_in" 2>>"$run_log" || import_fail compare 'the source did not accept the sequence query'
  source_sequences=''
  deadline=$((SECONDS + read_timeout))
  while :; do
    remaining=$((deadline - SECONDS))
    ((remaining > 0)) || import_fail compare 'reading the source sequences timed out'
    IFS= read -r -t "$remaining" -u "$psql_out" line || import_fail compare 'the source stopped while reading its sequences'
    line="${line%$'\r'}"
    [[ "$line" != "$sequences_end" ]] || break
    [[ "$line" =~ $sequence_line_re ]] || import_fail compare 'the source returned a malformed sequence state'
    source_sequences+="$line"$'\n'
  done
  source_sequences="${source_sequences%$'\n'}"
}

# source_snapshot opens one read-only REPEATABLE READ session on Heroku,
# exports its snapshot, refuses (exit 2) a different PostgreSQL major or user
# tables outside public, and counts and checksums every table inside the
# snapshot with backup.sh's queries. The session stays open for pg_dump.
source_snapshot() {
  local version line remaining deadline coproc_in coproc_out schemas large_objects extensions missing
  # The session covers the count pass and the whole dump, each capped at
  # import_timeout.
  coproc SRC { source_container psql "$((2 * import_timeout + coproc_grace))" psql -X -q -A -t -F "$tab" -v ON_ERROR_STOP=1; }
  psql_pid="${SRC_PID:-}"; coproc_in="${SRC[1]:-}"; coproc_out="${SRC[0]:-}"
  [[ -n "$psql_pid" && -n "$coproc_in" && -n "$coproc_out" ]] || import_fail source 'the source psql session exited immediately'
  exec {psql_in}>&"$coproc_in" {psql_out}<&"$coproc_out"
  exec {coproc_in}>&- {coproc_out}<&-
  printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;' 'SELECT pg_export_snapshot();' 1>&"$psql_in" 2>>"$run_log" \
    || import_fail source 'the source did not accept the snapshot transaction'
  IFS= read -r -t "$read_timeout" -u "$psql_out" snapshot_id || import_fail source 'the source did not export a snapshot (connection, TLS, or credentials; see the log)'
  snapshot_id="${snapshot_id%$'\r'}"
  [[ "$snapshot_id" =~ ^[0-9A-Fa-f]+-[0-9A-Fa-f]+(-[0-9]+)?$ ]] || import_fail source 'the source returned an invalid snapshot identifier'

  printf '%s\n' 'SHOW server_version_num;' 1>&"$psql_in" 2>>"$run_log" || import_fail source 'the source did not accept the version query'
  IFS= read -r -t "$read_timeout" -u "$psql_out" version || import_fail source 'the source did not report its version'
  pg_major_of "${version%$'\r'}" source_major || import_fail source 'the source returned an invalid server_version_num'
  [[ "$source_major" == "$postgres_major" ]] || die "the source runs PostgreSQL $source_major but the private PostgreSQL and its clients are $postgres_major; nothing was written"

  printf '%s\n' "SELECT coalesce(string_agg(DISTINCT regexp_replace(format('%I', schemaname), '[[:cntrl:]]', '?', 'g'), ',' ORDER BY regexp_replace(format('%I', schemaname), '[[:cntrl:]]', '?', 'g')), '') FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'public') AND schemaname !~ '^pg_(toast_)?temp_';" \
    1>&"$psql_in" 2>>"$run_log" || import_fail source 'the source did not accept the schema query'
  IFS= read -r -t "$read_timeout" -u "$psql_out" schemas || import_fail source 'the source did not list its schemas'
  schemas="${schemas%$'\r'}"
  [[ -z "$schemas" ]] || die "the source has user tables outside the public schema, which this import does not copy: $schemas; nothing was written"

  # pg_dump --schema=public copies neither large objects nor extensions.
  printf '%s\n' "$large_objects_sql" 1>&"$psql_in" 2>>"$run_log" || import_fail source 'the source did not accept the large-object query'
  IFS= read -r -t "$read_timeout" -u "$psql_out" large_objects || import_fail source 'the source did not count its large objects'
  large_objects="${large_objects%$'\r'}"
  [[ "$large_objects" =~ ^[0-9]+$ ]] || import_fail source 'the source returned an invalid large-object count'
  [[ "$large_objects" == 0 ]] || die "the source holds $large_objects large objects, which this import does not copy; nothing was written"
  printf '%s\n' "$extensions_sql" 1>&"$psql_in" 2>>"$run_log" || import_fail source 'the source did not accept the extension query'
  IFS= read -r -t "$read_timeout" -u "$psql_out" extensions || import_fail source 'the source did not list its extensions'
  extensions="${extensions%$'\r'}"
  if [[ -n "$extensions" ]]; then
    [[ "$extensions_created" == 1 ]] \
      || die "the source uses extensions this import does not create: $extensions; create them in the same schemas on the target (deploy/README.md), then rerun with --extensions-created; nothing was written"
    missing="$(target_missing_extensions "$extensions")" || die 'cannot list the extensions of the private PostgreSQL'
    [[ -z "$missing" ]] || die "--extensions-created, but the target lacks: $missing; nothing was written"
  fi

  printf '%s\n' "$output_settings_sql" "$count_sql" "SELECT '$counts_end';" 1>&"$psql_in" 2>>"$run_log" || import_fail source 'the source did not accept the count query'
  manifest=''
  deadline=$((SECONDS + import_timeout))
  while :; do
    remaining=$((deadline - SECONDS))
    ((remaining > 0)) || import_fail source 'counting the source rows timed out'
    IFS= read -r -t "$remaining" -u "$psql_out" line || import_fail source 'the source stopped while counting rows'
    line="${line%$'\r'}"
    [[ "$line" != "$counts_end" ]] || break
    [[ "$line" =~ $count_line_re ]] || import_fail source 'the source returned a malformed row count or checksum'
    manifest+="$line"$'\n'
  done
  [[ -n "$manifest" ]] || die 'the source has no user tables; nothing was written'
  [[ $'\n'"$manifest" == *$'\n'"$migrations_key"$'\t'* ]] || die "the source has no $migrations_key table; check PGDATABASE; nothing was written"
}

cmd_import() {
  local freeze_marked=0 found pipeline_start dump_end finished restored target_sequences status=0 key now mark_epoch analyze_start
  local -a pipe
  extensions_created=0
  while (($#)); do
    case "$1" in
      --freeze-marked) freeze_marked=1; shift ;;
      --extensions-created) extensions_created=1; shift ;;
      *) die 'usage: rehearse.sh import [--freeze-marked] [--extensions-created]' ;;
    esac
  done
  require_root
  require_command flock; require_command date
  bounded_seconds "$import_timeout" MAWAREETH_REHEARSAL_IMPORT_TIMEOUT
  preflight_runtime
  pg_user="${runtime_values[POSTGRES_USER]}"; pg_db="${runtime_values[POSTGRES_DB]}"
  load_source_file
  open_rehearsal_dirs
  lock_for_mutation
  acquire_backup_lock
  open_rehearsal_log import

  find_target
  for key in app-blue app-green; do
    found="$(service_container "$key")"
    [[ -z "$found" ]] || die "$key is running; stop both application slots before importing (the import needs an idle database)"
  done
  found="$(target_psql "$read_timeout" <<<"$target_objects_sql")" || die 'cannot inspect the private PostgreSQL database'
  found="${found//$'\r'/}"
  [[ "$found" =~ ^[0-9]+$ ]] || die 'the private PostgreSQL returned an invalid object count'
  [[ "$found" == 0 ]] || die "the private PostgreSQL database already holds $found user objects (relations, sequences, views, types, or functions); the import never restores over existing data (see deploy/README.md to reset it)"
  if [[ "$freeze_marked" == 1 ]]; then
    { read_record "$rehearsal_dir/mark-freeze-start" && [[ "${record[epoch]:-}" =~ $epoch_re ]]; } \
      || die '--freeze-marked needs a freeze-start mark; run rehearse.sh mark freeze-start when writes stop'
    mark_epoch=$((10#${record[epoch]})); now="$(now_epoch)"
    ((mark_epoch <= now + clock_skew_seconds && now - mark_epoch <= freeze_mark_max_age)) \
      || die "the freeze-start mark is not from the last ${freeze_mark_max_age}s; mark freeze-start again when writes stop"
    if read_record "$import_evidence" && [[ "${record[started_epoch]:-}" =~ $epoch_re ]]; then
      ((mark_epoch > 10#${record[started_epoch]})) || die 'the freeze-start mark is older than the last import; mark freeze-start again when writes stop'
    fi
  fi

  rehearse_mode=import
  stage=source
  started_epoch="$(now_epoch)"
  say "import $run_stamp started; the source session is read only"
  source_snapshot
  tables="$(grep -c . <<<"$manifest")"
  count_seconds=$(( $(now_epoch) - started_epoch ))
  if [[ "$freeze_marked" == 1 ]]; then
    freeze_mark=operator
  else
    # A rehearsal simulates the write freeze from the moment the import began.
    write_mark freeze-start "$started_epoch" || import_fail source 'could not record the freeze-start mark'
    freeze_mark=import-start
  fi

  stage=restore
  dump_end_file="$rehearsal_dir/.dump-end-$run_token"
  pipeline_start="$(now_epoch)"
  set +e
  {
    source_container dump "$import_timeout" pg_dump -Fc --no-owner --no-acl --schema=public "--snapshot=$snapshot_id"
    status=$?
    now_epoch > "$dump_end_file"
    exit "$status"
  } | timeout --kill-after=10 "$((import_timeout + 30))" docker exec -i "$pg_container" timeout "$import_timeout" \
        pg_restore --exit-on-error --single-transaction --no-owner --no-acl --schema=public -U "$pg_user" -d "$pg_db" >>"$run_log" 2>&1 8>&- 9>&-
  pipe=("${PIPESTATUS[@]}")
  set -e
  finished="$(now_epoch)"
  restore_seconds=$((finished - pipeline_start))
  dump_end="$(cat "$dump_end_file" 2>/dev/null)" || dump_end=''
  rm -f -- "$dump_end_file"
  if [[ "$dump_end" =~ $epoch_re ]]; then dump_seconds=$((dump_end - pipeline_start)); fi
  # SIGPIPE is ignored, so a failed restore leaves pg_dump with EPIPE (any
  # status): the restore is checked first. --single-transaction rolls back a
  # failed restore, so the target stays empty either way.
  [[ "${pipe[1]}" == 0 ]] || import_fail restore "pg_restore failed (status ${pipe[1]}; pg_dump ${pipe[0]}); it was rolled back"
  [[ "${pipe[0]}" == 0 ]] || import_fail dump "pg_dump failed (status ${pipe[0]}) although pg_restore accepted its output; reset the target before retrying (deploy/README.md)"

  read_source_sequences
  printf '%s\n' 'COMMIT;' 1>&"$psql_in" 2>>"$run_log" || import_fail dump 'the source did not accept COMMIT'
  close_psql
  status=0
  wait "$psql_pid" || status=$?
  exec {psql_out}<&-
  psql_pid=''
  [[ "$status" == 0 ]] || import_fail dump "the source snapshot session failed (status $status)"

  stage=compare
  restored="$(target_psql "$import_timeout" <<<"$output_settings_sql"$'\n'"$count_sql")" || import_fail compare 'counting the imported rows failed'
  restored="${restored//$'\r'/}"
  compare_seconds=$(( $(now_epoch) - finished ))
  manifest="${manifest%$'\n'}"
  if [[ "$restored" != "$manifest" ]]; then
    if ! diff <(printf '%s\n' "$manifest") <(printf '%s\n' "$restored") >>"$run_log" 2>&1; then :; fi
    say "tables whose count or checksum differ: $(diff <(printf '%s\n' "$manifest") <(printf '%s\n' "$restored") | sed -n 's/^[<>] \([^\t]*\)\t.*$/\1/p' | sort -u | paste -sd, -)"
    import_fail compare 'the imported tables differ from the source snapshot'
  fi
  target_sequences="$(target_psql "$read_timeout" <<<"$sequences_sql")" || import_fail compare 'reading the imported sequences failed'
  target_sequences="${target_sequences//$'\r'/}"
  if [[ "$target_sequences" != "$source_sequences" ]]; then
    if ! diff <(printf '%s\n' "$source_sequences") <(printf '%s\n' "$target_sequences") >>"$run_log" 2>&1; then :; fi
    say "sequences whose state differs: $(diff <(printf '%s\n' "$source_sequences") <(printf '%s\n' "$target_sequences") | sed -n 's/^[<>] \([^\t]*\)\t.*$/\1/p' | sort -u | paste -sd, -)"
    import_fail compare 'the imported sequences differ from the source (last_value or is_called)'
  fi
  compare_seconds=$(( $(now_epoch) - finished ))

  stage=analyze
  analyze_start="$(now_epoch)"
  target_psql "$import_timeout" <<<'ANALYZE;' >>"$run_log" || import_fail analyze 'ANALYZE on the imported database failed'
  analyze_seconds=$(( $(now_epoch) - analyze_start ))
  write_import_evidence pass || exit 4
  say "import complete: $tables tables match the source snapshot on counts and checksums, sequences match (dump ${dump_seconds:-?}s, restore ${restore_seconds}s, compare ${compare_seconds}s, analyze ${analyze_seconds}s)"
  say 'next: deploy the release with deploy/release.sh deploy (it runs the migrations), then mark validated'
}

# --- mark ----------------------------------------------------------------------

cmd_mark() {
  local phase="${1:-}" epoch
  { [[ $# -eq 1 ]] && in_list "$phase" "${phases[@]}"; } || die "usage: rehearse.sh mark {$(IFS='|'; printf '%s' "${phases[*]}")}"
  require_root
  open_rehearsal_dirs
  epoch="$(now_epoch)"
  [[ "$epoch" =~ $epoch_re ]] || die 'the system clock is unreadable'
  if [[ -e "$rehearsal_dir/mark-$phase" ]]; then say "replacing the earlier $phase mark"; fi
  write_mark "$phase" "$epoch" || { say "could not write the $phase mark"; exit 4; }
  say "recorded $phase at $(date -u -d "@$epoch" +%Y-%m-%dT%H:%M:%SZ)"
}

# --- capacity ------------------------------------------------------------------

write_capacity_evidence() {
  local content key
  content="result=$1
finished_at=$(now_iso)
finished_epoch=$(now_epoch)
started_epoch=$started_epoch
minutes=$minutes
sample_interval=$sample_interval
active_slot=${active:-}
started_slot=$capacity_slot"
  # duration_seconds is measured from the samples, not the requested minutes.
  for key in samples first_epoch last_epoch duration_seconds windows peak_cpu_window_percent peak_memory_window_percent peak_memory_sample_percent \
    swap_in_delta swap_out_delta oom_kill_delta breaches; do
    content+=$'\n'"$key=${capacity_fields[$key]:-}"
  done
  for key in requests errors error_rate_percent requests_per_second seconds started_epoch finished_epoch; do
    content+=$'\n'"load_$key=${load_fields[$key]:-}"
  done
  # read_record keys are [a-z_], so the 95th-percentile latency is "tail".
  content+=$'\n'"load_tail_latency_ms=${load_fields[p95_ms]:-}"
  content+=$'\n'"samples_file=$samples_file"$'\n'"log=$run_log"
  atomic_write "$capacity_evidence" 0600 "$content" || { say "could not write $capacity_evidence"; return 1; }
  outcome_written=1
}

stop_capacity_slot() {
  [[ "$slot_started" == 1 ]] || return 0
  if compose_bounded "$((stop_seconds + 30))" stop -t "$stop_seconds" "app-$capacity_slot" >>"$run_log" 2>&1 8>&-; then
    slot_started=0
    say "stopped app-$capacity_slot"
    return 0
  fi
  say "CRITICAL: could not stop app-$capacity_slot; stop it with deploy/runtime.sh status and docker compose stop"
  return 1
}

stop_sampler() {
  [[ -n "$sampler_pid" ]] || return 0
  if ! kill "$sampler_pid" 2>/dev/null; then :; fi
  if ! wait "$sampler_pid" 2>/dev/null; then :; fi
  sampler_pid=''
}

stop_load_reader() {
  [[ -n "$load_reader_pid" ]] || return 0
  if ! kill "$load_reader_pid" 2>/dev/null; then :; fi
  if ! wait "$load_reader_pid" 2>/dev/null; then :; fi
  load_reader_pid=''
}

# watch_load_input returns once the sampler exits. Over a non-interactive SSH
# session a dropped connection sends no hangup, only EOF on standard input, so
# input closing while the sampler still runs fails the run instead of sampling on.
watch_load_input() {
  local closed_at=''
  while kill -0 "$sampler_pid" 2>/dev/null; do
    if [[ -z "$closed_at" ]] && ! kill -0 "$load_reader_pid" 2>/dev/null; then closed_at=$SECONDS; fi
    if [[ -n "$closed_at" ]] && ((SECONDS - closed_at >= input_closed_grace)); then
      capacity_fail load 'standard input closed before the sampling finished: the load generator stopped or the workstation disconnected'
    fi
    sleep 1
  done
}

# collect_load_summary waits at most load_wait seconds for standard input to
# close after the sampling, then parses the summary it carried.
collect_load_summary() {
  local deadline=$((SECONDS + load_wait))
  while kill -0 "$load_reader_pid" 2>/dev/null; do
    ((SECONDS < deadline)) || return 1
    sleep 1
  done
  if ! wait "$load_reader_pid" 2>/dev/null; then :; fi
  load_reader_pid=''
  read_load_summary < "$load_tmp"
}

# capacity_fail SIGNAL MESSAGE: stop the slot, record fail:SIGNAL, exit 4.
capacity_fail() {
  trap '' INT TERM HUP
  say "capacity run failed: $2"
  stop_sampler
  if ! stop_capacity_slot; then :; fi
  write_capacity_evidence "fail:$1" || exit 4
  exit 4
}

# read_load_summary reads the load generator's key=value summary from
# standard input until EOF, waiting at most load_wait seconds.
read_load_summary() {
  local deadline=$((SECONDS + load_wait)) line remaining status lines=0
  while :; do
    remaining=$((deadline - SECONDS))
    ((remaining > 0)) || return 1
    status=0
    IFS= read -r -t "$remaining" line || status=$?
    ((status <= 128)) || return 1
    line="${line%$'\r'}"
    if [[ "$line" =~ ^([a-z_0-9]+)=([^[:cntrl:]]{0,200})$ ]]; then load_fields[${BASH_REMATCH[1]}]="${BASH_REMATCH[2]}"; fi
    lines=$((lines + 1))
    ((lines <= 200)) || return 1
    ((status == 0)) || break
  done
  [[ "${load_fields[requests]:-}" =~ ^[0-9]{1,15}$ && "${load_fields[errors]:-}" =~ ^[0-9]{1,15}$ ]] || return 1
  ((10#${load_fields[errors]} <= 10#${load_fields[requests]}))
}

# check_load_coverage fails the run (load) unless the load ran for the whole
# sampling window: started at or before the first sample, finished at or after
# the last, and lasted at least the measured duration minus one interval.
check_load_coverage() {
  local seconds first last duration
  first="${capacity_fields[first_epoch]:-}"; last="${capacity_fields[last_epoch]:-}"; duration="${capacity_fields[duration_seconds]:-}"
  [[ "$first" =~ $epoch_re && "$last" =~ $epoch_re && "$duration" =~ ^[0-9]{1,12}$ ]] || capacity_fail samples 'the evaluation did not report the sampling window'
  [[ "${load_fields[seconds]:-}" =~ ^([0-9]{1,12})(\.[0-9]+)?$ ]] || capacity_fail load 'the load summary has no valid seconds'
  seconds="${BASH_REMATCH[1]}"
  [[ "${load_fields[started_epoch]:-}" =~ $epoch_re && "${load_fields[finished_epoch]:-}" =~ $epoch_re ]] \
    || capacity_fail load 'the load summary has no valid started_epoch and finished_epoch'
  ((10#$seconds >= 10#$duration - 10#$sample_interval)) \
    || capacity_fail load "the load ran ${seconds}s but the samples span ${duration}s; run the load for the whole sampling window"
  ((10#${load_fields[started_epoch]} <= 10#$first && 10#${load_fields[finished_epoch]} >= 10#$last)) \
    || capacity_fail load "the load (${load_fields[started_epoch]}-${load_fields[finished_epoch]}) does not cover the samples ($first-$last); start it before capacity and run it longer"
}

cmd_capacity() {
  local inactive snapshot evaluation line host_result id status=0
  minutes="$default_minutes"
  while (($#)); do
    case "$1" in
      --minutes) [[ "${2:-}" =~ ^[1-9][0-9]{0,2}$ ]] || die '--minutes must be 1-999'; minutes="$2"; shift 2 ;;
      *) die 'usage: rehearse.sh capacity [--minutes N] < load-generator-summary' ;;
    esac
  done
  require_root
  require_command flock; require_command date
  bounded_seconds "$sample_interval" MAWAREETH_REHEARSAL_SAMPLE_INTERVAL
  bounded_seconds "$load_wait" MAWAREETH_REHEARSAL_LOAD_WAIT
  bounded_seconds "$startup_timeout" MAWAREETH_RUNTIME_WAIT_TIMEOUT
  [[ -f "$rehearsal_py" ]] || die "missing $rehearsal_py"
  [[ ! -t 0 ]] || die 'pipe the workstation load generator into capacity (deploy/README.md: Cutover rehearsal)'
  preflight_runtime
  open_rehearsal_dirs
  ensure_state_subdirs existing
  lock_for_mutation
  acquire_backup_lock
  open_rehearsal_log capacity

  read_active_slot || die 'no persisted route exists; deploy a release first'
  active="$ACTIVE_SLOT"; inactive="$(other_slot "$active")"
  read_slot_record "$active" || die "the active app-$active has no slot record"
  validate_image "$SLOT_IMAGE"
  read_slot_record "$inactive" || die "app-$inactive has no slot record; deploy a second release so both slots have one, then rerun"
  validate_image "$SLOT_IMAGE"
  snapshot="$state_dir/$SLOT_SNAPSHOT"
  file_metadata "$snapshot" 600 "the app-$inactive runtime snapshot"
  [[ "$(sha256sum "$snapshot" | awk '{print $1}')" == "${SLOT_SNAPSHOT%.snapshot.env}" ]] || die "the app-$inactive runtime snapshot content drifted"
  APP_SNAPSHOT="$snapshot"
  load_slot_images ''
  find_target
  id="$(service_container "app-$active")"
  [[ -n "$id" ]] || die "the active app-$active is not running; run deploy/runtime.sh up first"
  id="$(service_container "app-$inactive")"
  [[ -z "$id" ]] || die "app-$inactive is already running; capacity only measures a slot it starts itself"

  rehearse_mode=capacity
  capacity_slot="$inactive"
  started_epoch="$(now_epoch)"
  say "starting app-$inactive from its slot record; the route stays on app-$active"
  slot_started=1
  compose_bounded "$((startup_timeout + 30))" up -d --no-build --pull never --no-deps --wait --wait-timeout "$startup_timeout" "app-$inactive" >>"$run_log" 2>&1 8>&- \
    || capacity_fail start "app-$inactive did not become healthy"

  say "sampling the host for $minutes minutes every ${sample_interval}s"
  samples_tmp="$(mktemp "$rehearsal_dir/.samples.XXXXXX")" || capacity_fail samples 'could not allocate the sample file'
  load_tmp="$(mktemp "$rehearsal_dir/.load.XXXXXX")" || capacity_fail load 'could not allocate the load summary file'
  # The explicit <&0 keeps standard input: an asynchronous command otherwise reads /dev/null.
  head -c 65536 <&0 > "$load_tmp" 2>>"$run_log" 8>&- 9>&- &
  load_reader_pid=$!
  python3 -I "$rehearsal_py" sample --proc "$proc_dir" --interval "$sample_interval" --minutes "$minutes" > "$samples_tmp" 2>>"$run_log" 8>&- 9>&- &
  sampler_pid=$!
  watch_load_input
  wait "$sampler_pid" || status=$?
  sampler_pid=''
  ((status == 0)) || capacity_fail samples "sampling the host failed (status $status)"
  { chmod 0600 "$samples_tmp" && mv -f -- "$samples_tmp" "$samples_file"; } || capacity_fail samples 'could not publish the sample file'
  samples_tmp=''

  collect_load_summary || capacity_fail load "no valid load generator summary arrived on standard input within ${load_wait}s of the sampling"
  stop_capacity_slot || capacity_fail stop "app-$inactive could not be stopped"

  status=0
  evaluation="$(python3 -I "$rehearsal_py" evaluate "$samples_file" 2>>"$run_log")" || status=$?
  ((status == 0 || status == 4)) || capacity_fail samples 'the sample file could not be evaluated'
  while IFS= read -r line; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^([a-z_]+)=([^[:cntrl:]]*)$ ]]; then capacity_fields[${BASH_REMATCH[1]}]="${BASH_REMATCH[2]}"; fi
  done <<<"$evaluation"
  host_result="${capacity_fields[result]:-}"
  [[ "$host_result" == pass || "$host_result" =~ ^fail:[a-z-]+$ ]] || capacity_fail samples 'the evaluation returned no result'
  [[ "$host_result" == pass ]] || capacity_fail "${host_result#fail:}" "the host breached a threshold (${capacity_fields[breaches]}); peak 15-minute CPU ${capacity_fields[peak_cpu_window_percent]}%, memory ${capacity_fields[peak_memory_window_percent]}%"
  check_load_coverage
  # More than 1% of the requests failed, compared exactly in integers.
  if ((10#${load_fields[requests]} == 0 || 10#${load_fields[errors]} * 100 > 10#${load_fields[requests]})); then
    capacity_fail load-errors "the load generator saw ${load_fields[errors]} errors in ${load_fields[requests]} requests (limit 1%)"
  fi
  write_capacity_evidence pass || exit 4
  say "capacity passed: peak 15-minute CPU ${capacity_fields[peak_cpu_window_percent]}%, memory ${capacity_fields[peak_memory_window_percent]}%, no swap or OOM, ${load_fields[requests]} requests with ${load_fields[errors]} errors (p95 ${load_fields[p95_ms]:-?} ms)"
}

# --- report --------------------------------------------------------------------

cmd_report() {
  local now age phase key out='' item gate=pass path=undetermined freeze_span dns_span start validated switched import_finished
  local -A mark=()
  local -a unmet=()
  require_root
  [[ $# -eq 0 ]] || die 'usage: rehearse.sh report'
  open_rehearsal_dirs
  now="$(now_epoch)"
  [[ "$now" =~ $epoch_re ]] || die 'the system clock is unreadable'
  add() { out+="$1=$2"$'\n'; }

  import_finished=''
  if read_record "$import_evidence"; then
    add import_result "${record[result]:-}"
    for key in finished_at tables count_seconds dump_seconds restore_seconds compare_seconds analyze_seconds total_seconds freeze_start; do add "import_$key" "${record[$key]:-}"; done
    [[ "${record[result]:-}" == pass ]] || unmet+=("the import result is ${record[result]:-missing}, not pass")
    if [[ "${record[finished_epoch]:-}" =~ $epoch_re ]]; then import_finished=$((10#${record[finished_epoch]})); fi
  else
    add import_result missing; unmet+=("no import evidence at $import_evidence; run rehearse.sh import")
  fi

  if read_record "$capacity_evidence"; then
    add capacity_result "${record[result]:-}"
    for key in finished_at minutes duration_seconds started_slot peak_cpu_window_percent peak_memory_window_percent swap_in_delta swap_out_delta oom_kill_delta \
      load_requests load_errors load_error_rate_percent load_tail_latency_ms load_seconds; do add "capacity_$key" "${record[$key]:-}"; done
    if [[ "${record[result]:-}" != pass ]]; then
      unmet+=("the capacity result is ${record[result]:-missing}, not pass")
    elif [[ ! "${record[duration_seconds]:-}" =~ ^[0-9]{1,12}$ ]] || ((10#${record[duration_seconds]} < capacity_min_seconds)); then
      unmet+=("the passing capacity run measured ${record[duration_seconds]:-no} seconds of samples; at least $capacity_min_seconds are required")
    fi
    if [[ -n "$import_finished" ]]; then
      { [[ "${record[started_epoch]:-}" =~ $epoch_re ]] && ((10#${record[started_epoch]} > import_finished)); } \
        || unmet+=('the capacity run did not start after the import finished; rerun capacity against the imported data')
    fi
  else
    add capacity_result missing; unmet+=("no capacity evidence at $capacity_evidence; run rehearse.sh capacity")
  fi

  # Story 0.7's restore record, held to the backup gate's own limits.
  if read_record "$evidence_file"; then
    add restore_result "${record[result]:-}"
    for key in verified_at dump_age_seconds duration_seconds restore_seconds rpo_seconds rto_seconds; do add "restore_$key" "${record[$key]:-}"; done
    if [[ "${record[result]:-}" != pass ]]; then
      unmet+=("the restore verification result is ${record[result]:-missing}, not pass")
    elif [[ ! "${record[verified_epoch]:-}" =~ $epoch_re ]]; then
      unmet+=('the restore evidence has no valid verification time')
    else
      age=$((now - 10#${record[verified_epoch]}))
      ((age >= -clock_skew_seconds && age <= evidence_max_age)) || unmet+=("the passing restore evidence is ${age}s old (limit 35 days)")
      for key in rpo_seconds:"$rpo_seconds" dump_age_seconds:"$rpo_seconds" rto_seconds:"$rto_seconds" duration_seconds:"$rto_seconds"; do
        item="${record[${key%%:*}]:-}"
        { [[ "$item" =~ ^[0-9]{1,12}$ ]] && ((10#$item <= ${key#*:})); } || unmet+=("the restore evidence ${key%%:*} is ${item:-missing} (limit ${key#*:})")
      done
      if [[ -n "$import_finished" ]] && ((10#${record[verified_epoch]} <= import_finished)); then
        unmet+=('the restore was verified before the import finished; run backup.sh backup and verify-restore after the import')
      fi
    fi
  else
    add restore_result missing; unmet+=("no readable restore evidence at $evidence_file; run deploy/backup.sh verify-restore")
  fi

  for phase in "${phases[@]}"; do
    if read_record "$rehearsal_dir/mark-$phase" && [[ "${record[phase]:-}" == "$phase" && "${record[epoch]:-}" =~ $epoch_re ]] \
      && ((10#${record[epoch]} <= now + clock_skew_seconds)); then
      mark[$phase]=$((10#${record[epoch]}))
      add "mark_${phase//-/_}" "${record[at]:-}"
    else
      add "mark_${phase//-/_}" missing
      unmet+=("the $phase mark is missing or invalid; run rehearse.sh mark $phase")
    fi
  done
  # order BEFORE AFTER: both present and BEFORE not later than AFTER.
  order() {
    [[ -n "${mark[$1]:-}" && -n "${mark[$2]:-}" ]] || return 0
    ((${mark[$1]} <= ${mark[$2]})) || unmet+=("the $1 mark is later than the $2 mark")
  }
  order ttl-lowered freeze-start; order freeze-start validated; order validated dns-switched
  order dns-switched dns-rolled-back; order validated rollback-point
  order dns-switched rollback-point; order rollback-point dns-rolled-back
  span() { if [[ -n "${mark[$2]:-}" && -n "${mark[$3]:-}" ]]; then add "$1" $((${mark[$3]} - ${mark[$2]})); else add "$1" ''; fi; }
  span phase_ttl_lead_seconds ttl-lowered freeze-start
  span phase_freeze_to_validated_seconds freeze-start validated
  span phase_freeze_to_dns_seconds freeze-start dns-switched
  span phase_dns_rollback_seconds dns-switched dns-rolled-back
  span phase_freeze_to_rollback_point_seconds freeze-start rollback-point

  if [[ -n "${mark[freeze-start]:-}" && -n "${mark[validated]:-}" && -n "${mark[dns-switched]:-}" ]]; then
    start="${mark[freeze-start]}"; validated="${mark[validated]}"; switched="${mark[dns-switched]}"
    freeze_span=$((validated - start)); dns_span=$((switched - start))
    if ((freeze_span <= freeze_budget && dns_span <= dns_budget)); then
      path=write-freeze
    else
      path=replication
      unmet+=("the write freeze took ${freeze_span}s to validation (limit ${freeze_budget}s) and ${dns_span}s to the DNS switch (limit ${dns_budget}s); story 0.10 needs the replication path")
    fi
  fi
  add path "$path"
  ((${#unmet[@]} == 0)) || gate=unmet
  add gate "$gate"
  add unmet_items "${#unmet[@]}"
  add generated_at "$(now_iso)"
  out="${out%$'\n'}"
  printf '%s\n' "$out"
  atomic_write "$report_file" 0600 "$out" || { say "could not write $report_file"; exit 4; }
  for item in "${unmet[@]}"; do say "gate unmet: $item"; done
  if [[ "$gate" == pass ]]; then say "gate passed: the cutover can use the $path path"; return 0; fi
  exit 1
}

# --- process safety net -------------------------------------------------------

rehearse_on_exit() {
  local status=$?
  trap '' INT TERM HUP
  stop_sampler
  stop_load_reader
  close_psql
  [[ -z "$samples_tmp" ]] || rm -f -- "$samples_tmp"
  [[ -z "$load_tmp" ]] || rm -f -- "$load_tmp"
  [[ -z "$dump_end_file" ]] || rm -f -- "$dump_end_file"
  if [[ "$rehearse_mode" == import ]]; then
    if ! reap_source_containers; then say "could not remove this run's source containers; remove them with docker rm -f"; fi
  fi
  if [[ "$rehearse_mode" == capacity ]]; then
    if ! stop_capacity_slot; then :; fi
  fi
  # A refusal (exit 2) wrote nothing and records nothing.
  if [[ "$outcome_written" == 0 && "$status" != 2 && -n "$rehearse_mode" ]]; then
    say "$rehearse_mode stopped unexpectedly (status $status) during ${stage:-setup}"
    if [[ "$rehearse_mode" == import ]]; then
      if ! write_import_evidence fail:interrupted; then :; fi
    else
      if ! write_capacity_evidence fail:interrupted; then :; fi
    fi
  fi
  exit "$status"
}

rehearse_main() {
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap '' PIPE
  trap rehearse_on_exit EXIT
  local command="${1:-}"
  [[ $# -eq 0 ]] || shift
  case "$command" in
    import) cmd_import "$@" ;;
    mark) cmd_mark "$@" ;;
    capacity) cmd_capacity "$@" ;;
    report) cmd_report "$@" ;;
    *) die 'usage: rehearse.sh {import [--freeze-marked]|mark PHASE|capacity [--minutes N]|report}' ;;
  esac
}

rehearse_main "$@"
