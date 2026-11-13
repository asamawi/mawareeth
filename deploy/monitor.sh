#!/usr/bin/env bash
# Host monitoring for the shared SCDF Prometheus/Alertmanager on p1.
#
#   sudo deploy/monitor.sh install   Tailscale, node_exporter on the Tailscale
#                                    IPv4 only (textfile and systemd
#                                    collectors; re-run to upgrade the wrapper),
#                                    UFW (9100 and SSH on tailscale0), journald
#                                    bounds, collector, daily token check,
#                                    daily expired-session cleanup
#   sudo deploy/monitor.sh collect   publish backup/restore records as metrics
#                                    (including whether the last ok backup
#                                    holds every archive), each origin
#                                    certificate file's earliest notAfter, and
#                                    the token check record; never uses the
#                                    network
#   sudo deploy/monitor.sh token-check
#                                    ask GitHub (/rate_limit, no quota) whether
#                                    the deploy's read token works and when it
#                                    expires, and record the answer; the next
#                                    collect publishes it
#   sudo deploy/monitor.sh clear-sessions
#                                    delete expired Django sessions (manage.py
#                                    clearsessions) in the container of the
#                                    active slot; the only command here that
#                                    touches a container or the database
#   sudo deploy/monitor.sh status    print the metrics a collect would publish,
#                                    the drill record and the token check record
#   sudo deploy/monitor.sh drill start
#   sudo deploy/monitor.sh drill confirm CODE --better-stack-received
#   sudo deploy/monitor.sh drill abort
#                                    alert-path drill: start publishes a random
#                                    six-digit code that MawareethAlertDrill
#                                    emails through the project=mawareeth route;
#                                    confirm records a pass only for that code
#                                    and the operator's assertion that the
#                                    manual Better Stack test alert arrived
#
# Exit codes: 0 success; 1 an install or drill write step failed; 2 refused
# (invalid input, environment, usage, or drill state; nothing was changed);
# 3 another monitor operation holds the monitor lock.
# `collect` exits 0 even when a record is absent, mis-owned, or malformed: the
# record's metrics are published as 0 so the matching alert fires. An origin
# certificate file that exists but cannot be read publishes 0 the same way; an
# absent one publishes no series. `token-check` exits 0 for every answer it can
# record, 1 only when it cannot write the record, and 3 when it cannot get the
# monitor lock for the write (it never holds the lock across the network call,
# and waits for it instead of giving up the day's check). The token value is never
# printed, logged, or put on argv or in the environment. Staleness and expiry
# are judged by the Prometheus rules (time() - metric); this script never
# compares clocks. Apart from `clear-sessions` (which reads the persisted route and
# runs one command in the active slot's container), it never takes the deploy or
# backup locks and never touches slots, routes, the deploy journal, snapshots,
# containers, or the database. `clear-sessions` exits 0 on success, 1 when it cannot
# clean (the unit retries, then fails and the existing failed-unit alert fires), 2 when
# refused. Tailscale is joined interactively by the operator (deploy/README.md); no auth
# key is accepted.
monitor_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/backup.sh
source "$monitor_script_dir/backup.sh"

textfile_dir="${MAWAREETH_TEXTFILE_DIR:-/var/lib/prometheus/node-exporter}"
journald_dir="${MAWAREETH_JOURNALD_DIR:-/etc/systemd/journald.conf.d}"
apt_dir="${MAWAREETH_APT_DIR:-/etc/apt}"
sbin_dir="${MAWAREETH_SBIN_DIR:-/usr/local/sbin}"
os_release_file="${MAWAREETH_OS_RELEASE:-/etc/os-release}"
monitor_lock_file="$state_dir/monitor.lock"
prom_file="$textfile_dir/mawareeth.prom"
exporter_unit=prometheus-node-exporter.service
exporter_dropin_dir="$systemd_dir/$exporter_unit.d"
exporter_wrapper="$sbin_dir/mawareeth-node-exporter"
collect_unit=mawareeth-monitor-collect
tailscale_key_url=https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg
tailscale_repo='https://pkgs.tailscale.com/stable/ubuntu noble main'
ufw_rule=(allow in on tailscale0 from 100.64.0.0/10 to any port 9100 proto tcp)
ssh_ufw_rule=(allow in on tailscale0 from 100.64.0.0/10 to any port 22 proto tcp)
epoch_re='^[1-9][0-9]{0,11}$'
drill_code_re='^[1-9][0-9]{5}$'
drill_dir="$state_dir/monitor"
drill_file="$drill_dir/drill"
drill_history_file="$drill_dir/drill-history"
drill_usage='usage: monitor.sh drill {start|confirm CODE --better-stack-received|abort}'
origin_certificate_files=(cert.pem aop-ca.pem aop-client.pem)
token_file="${MAWAREETH_GITHUB_TOKEN_FILE:-/etc/mawareeth/github-read.token}"
token_record="$drill_dir/github-token"
token_unit=mawareeth-github-token-check
sessions_unit=mawareeth-clear-sessions
sessions_timeout="${MAWAREETH_CLEAR_SESSIONS_TIMEOUT:-300}"
token_url=https://api.github.com/rate_limit
token_lock_wait="${MAWAREETH_TOKEN_LOCK_WAIT:-120}"

die() { printf 'monitor: %s\n' "$*" >&2; exit 2; }
say() { if ! printf 'monitor: %s\n' "$*" >&2 2>/dev/null; then :; fi; }
install_fail() { say "$*"; exit 1; }
require_root() { [[ ${EUID:-999} -eq 0 ]] || die 'must run as root'; }

# A non-blocking lock on descriptor 9 for the rest of the process.
acquire_monitor_lock() {
  [[ -d "$state_dir" && ! -L "$state_dir" ]] || die "runtime state directory $state_dir is missing; run deploy/runtime.sh prepare first"
  exec 9>>"$monitor_lock_file" || die "cannot open $monitor_lock_file"
  if ! flock -n 9; then
    say "another monitor operation holds $monitor_lock_file; nothing was changed"
    exit 3
  fi
}

# record_metrics FILE RESULT-KEY RESULT-VALUE EPOCH-KEY sets metric_ok and
# metric_ts: 1 and the epoch only for a usable record with the healthy result
# and a plain decimal epoch, otherwise 0 and 0.
record_metrics() {
  metric_ok=0; metric_ts=0
  read_record "$1" || return 0
  [[ "${record[$2]:-}" == "$3" && "${record[$4]:-}" =~ $epoch_re ]] || return 0
  metric_ok=1; metric_ts=$((10#${record[$4]}))
}

# archives_metric reads the backup record itself (so it does not depend on
# which record was read last) and sets archives_complete: 1 only when that
# record is usable (readable, with a plain decimal finished_epoch) and ok, and
# its host_state_snapshot and globals_snapshot are both Restic IDs (64 hex),
# so a run made by an older backup.sh, or a regression, is noticed.
archives_metric() {
  archives_complete=0
  read_record "$status_file" || return 0
  [[ "${record[result]:-}" == ok && "${record[finished_epoch]:-}" =~ $epoch_re ]] || return 0
  [[ "${record[host_state_snapshot]:-}" =~ ^[0-9a-f]{64}$ && "${record[globals_snapshot]:-}" =~ ^[0-9a-f]{64}$ ]] || return 0
  archives_complete=1
}

gauge() {
  printf '# HELP %s %s\n# TYPE %s gauge\n%s %s\n' "$1" "$2" "$1" "$1" "$3"
}

render_metrics() {
  local now
  now="$(now_epoch)" || die 'cannot read the clock'
  [[ "$now" =~ $epoch_re ]] || die 'the system clock is unreadable'
  record_metrics "$status_file" result ok finished_epoch
  gauge mawareeth_backup_last_ok_timestamp_seconds 'Finish time of the last backup when it is ok; 0 if the record is unusable or not ok.' "$metric_ts"
  gauge mawareeth_backup_last_result_ok '1 when the last backup record is usable and its result is ok.' "$metric_ok"
  archives_metric
  gauge mawareeth_backup_last_archives_complete '1 when the last backup record is usable, ok, and names its host-state and globals snapshots; otherwise 0.' "$archives_complete"
  record_metrics "$evidence_file" result pass verified_epoch
  gauge mawareeth_restore_last_pass_timestamp_seconds 'Verification time of the last restore check when it passed; 0 if the record is unusable or not pass.' "$metric_ts"
  gauge mawareeth_restore_last_result_pass '1 when the last restore verification record is usable and its result is pass.' "$metric_ok"
  drill_metrics
  gauge mawareeth_drill_active_code 'Code of the active alert-path drill; 0 when none is active or the drill record is unusable.' "$drill_code"
  gauge mawareeth_drill_last_pass_timestamp_seconds 'Time of the last passed alert-path drill; 0 if none passed or the drill record is unusable.' "$drill_last_pass"
  origin_certificate_metrics
  token_metrics
  gauge mawareeth_github_token_usable '0 when GitHub rejected the read token, the token file is unusable, or the check record is unusable; a transient check failure stays 1.' "$token_usable"
  gauge mawareeth_github_token_last_ok_timestamp_seconds 'Time of the last check GitHub accepted the read token; 0 if none is recorded or the check record is unusable.' "$token_last_ok"
  gauge mawareeth_github_token_expiry_timestamp_seconds 'Expiry of the read token as GitHub reported it; 0 if it never expires, is unknown, or the check record is unusable.' "$token_expiry"
  gauge mawareeth_monitor_collect_timestamp_seconds 'Time this file was last written by monitor.sh collect.' "$now"
}

# drill_metrics sets drill_code and drill_last_pass from the drill record with
# the same fail-closed reader: both 0 unless the record is usable; the code only
# while state=active with a six-digit code; the last pass only as a plain
# decimal epoch.
drill_metrics() {
  drill_code=0; drill_last_pass=0
  read_record "$drill_file" || return 0
  if [[ "${record[state]:-}" == active && "${record[code]:-}" =~ $drill_code_re ]]; then drill_code=$((10#${record[code]})); fi
  if [[ "${record[last_pass_epoch]:-}" =~ $epoch_re ]]; then drill_last_pass=$((10#${record[last_pass_epoch]})); fi
}

# certificate_expiry FILE sets cert_expiry to the earliest notAfter epoch across
# FILE's PEM certificate blocks, or 0 unless FILE is a root-owned regular
# non-symlink file with the modes preflight accepts, holding at least one block,
# every one of which parses. Text outside the blocks is ignored, as in
# aop_certificates (runtime.sh), which is not called here because it dies.
# Certificates are public; they reach openssl on stdin. A missing openssl fails
# like an unparsable certificate.
certificate_expiry() {
  local file="$1" line block='' inside=0 end epoch earliest=0
  local -a lines=()
  cert_expiry=0
  [[ -f "$file" && ! -L "$file" ]] || return 0
  case "$(stat -c '%u:%g:%a' "$file" 2>/dev/null)" in 0:0:600 | 0:0:644) ;; *) return 0 ;; esac
  mapfile -t lines < "$file" || return 0
  for line in "${lines[@]}"; do
    # Trailing whitespace (CRLF included) must not hide a PEM marker: a skipped
    # block would overstate the earliest expiry.
    line="${line%"${line##*[![:space:]]}"}"
    if ((inside)); then
      block+="$line"$'\n'
      [[ "$line" == '-----END CERTIFICATE-----' ]] || continue
      inside=0
      end="$(openssl x509 -noout -enddate <<<"$block" 2>/dev/null)" || return 0
      end="${end%$'\r'}"
      [[ "$end" == notAfter=* ]] || return 0
      epoch="$(date -u -d "${end#notAfter=}" +%s 2>/dev/null)" || return 0
      [[ "$epoch" =~ $epoch_re ]] || return 0
      if ((earliest == 0 || epoch < earliest)); then earliest="$epoch"; fi
    elif [[ "$line" == '-----BEGIN CERTIFICATE-----' ]]; then
      inside=1; block="$line"$'\n'
    fi
  done
  ((inside == 0)) || return 0
  cert_expiry="$earliest"
}

# origin_certificate_metrics prints one sample per origin certificate file that
# exists (a dangling symlink counts, and publishes 0). HELP and TYPE appear only
# with a sample: an acme host publishes nothing here.
origin_certificate_metrics() {
  local name path metric=mawareeth_origin_certificate_expiry_timestamp_seconds described=0
  for name in "${origin_certificate_files[@]}"; do
    # shellcheck disable=SC2154 # origin_tls_dir comes from runtime.sh, through backup.sh.
    path="$origin_tls_dir/$name"
    [[ -e "$path" || -L "$path" ]] || continue
    certificate_expiry "$path"
    if ((described == 0)); then
      printf '# HELP %s Earliest notAfter across the certificates of an origin TLS file; 0 if the file cannot be read.\n# TYPE %s gauge\n' "$metric" "$metric"
      described=1
    fi
    printf '%s{file="%s"} %s\n' "$metric" "$name" "$cert_expiry"
  done
}

# token_metrics sets token_usable, token_last_ok and token_expiry from the token
# check record, all 0 unless the whole record is well formed. Only a transient
# result=error stays usable: its age is judged by the last ok time, which is 0
# (so the alert fires) when no check has ever succeeded. expires_epoch=never
# publishes expiry 0, which the rule reads as no expiry.
token_metrics() {
  token_usable=0; token_last_ok=0; token_expiry=0
  read_record "$token_record" || return 0
  local result="${record[result]:-}" last_ok="${record[last_ok_epoch]:-}" expires="${record[expires_epoch]:-}"
  [[ "${record[checked_epoch]:-}" =~ $epoch_re ]] || return 0
  [[ -z "$last_ok" || "$last_ok" =~ $epoch_re ]] || return 0
  [[ -z "$expires" || "$expires" == never || "$expires" =~ $epoch_re ]] || return 0
  case "$result" in
    ok) [[ -n "$last_ok" && -n "$expires" ]] || return 0; token_usable=1 ;;
    error) token_usable=1 ;;
    rejected | missing) ;;
    *) return 0 ;;
  esac
  if [[ -n "$last_ok" ]]; then token_last_ok=$((10#$last_ok)); fi
  if [[ "$expires" =~ $epoch_re ]]; then token_expiry=$((10#$expires)); fi
}

check_textfile_dir() {
  [[ -d "$textfile_dir" && ! -L "$textfile_dir" ]] || die "textfile directory $textfile_dir is missing; run monitor.sh install"
}

publish_metrics() {
  local content
  content="$(render_metrics)" || exit 2
  # atomic_write appends the final newline; the .tmp.* name is ignored by the
  # textfile collector, which reads only *.prom.
  atomic_write "$prom_file" 0644 "${content%$'\n'}" || die "could not write $prom_file"
}

cmd_collect() {
  require_root
  require_command flock; require_command mktemp; require_command sync
  clean_path "$state_dir" MAWAREETH_RUNTIME_DIR
  clean_path "$textfile_dir" MAWAREETH_TEXTFILE_DIR
  clean_path "$origin_tls_dir" MAWAREETH_ORIGIN_TLS_DIR
  acquire_monitor_lock
  check_textfile_dir
  publish_metrics
}

cmd_status() {
  require_root
  clean_path "$state_dir" MAWAREETH_RUNTIME_DIR
  clean_path "$textfile_dir" MAWAREETH_TEXTFILE_DIR
  clean_path "$origin_tls_dir" MAWAREETH_ORIGIN_TLS_DIR
  [[ -d "$state_dir" && ! -L "$state_dir" ]] || die "runtime state directory $state_dir is missing; run deploy/runtime.sh prepare first"
  printf '== metrics a collect would publish\n'
  render_metrics
  printf '== %s\n' "$prom_file"
  if [[ -f "$prom_file" ]]; then cat -- "$prom_file"; else printf '(absent)\n'; fi
  printf '== %s\n' "$drill_file"
  if read_record "$drill_file"; then
    printf 'state=%s\nstarted_epoch=%s\nlast_result=%s\nlast_pass_at=%s\n' \
      "${record[state]:-}" "${record[started_epoch]:-}" "${record[last_result]:-}" "${record[last_pass_at]:-}"
  elif [[ -e "$drill_file" || -L "$drill_file" ]]; then
    printf '(unusable: it must be a root:root 0600 file of key=value lines)\n'
  else
    printf '(absent: no drill has run)\n'
  fi
  # The record never holds the token, only what GitHub said about it.
  printf '== %s\n' "$token_record"
  if read_record "$token_record"; then
    printf 'result=%s\nchecked_epoch=%s\nlast_ok_epoch=%s\nexpires_epoch=%s\n' \
      "${record[result]:-}" "${record[checked_epoch]:-}" "${record[last_ok_epoch]:-}" "${record[expires_epoch]:-}"
  elif [[ -e "$token_record" || -L "$token_record" ]]; then
    printf '(unusable: it must be a root:root 0600 file of key=value lines)\n'
  else
    printf '(absent: no token check has run)\n'
  fi
}

# --- GitHub read token check ------------------------------------------------------
# GitHub reports a fine-grained token's expiry only in a response header, so this
# calls /rate_limit, which spends no quota. It runs from its own daily timer;
# collect stays offline.

# token_probe sets probe_result (ok, rejected, missing or error) and, for ok,
# probe_expires (an epoch, or never when GitHub sends no expiry header). The
# token reaches curl through a config on a pipe, never argv or the environment.
# Redirects are not followed, so it is never sent to another host.
token_probe() {
  probe_result=missing; probe_expires=''
  local token response code line value='' has_header=0 status=0
  [[ -f "$token_file" && ! -L "$token_file" ]] || return 0
  [[ "$(stat -c '%u:%g:%a' "$token_file" 2>/dev/null)" == 0:0:600 ]] || return 0
  token="$(< "$token_file")" || return 0
  [[ "$token" =~ ^[A-Za-z0-9_]{20,255}$ ]] || return 0
  probe_result=error
  response="$(curl --config <(printf 'header = "Authorization: Bearer %s"\n' "$token") \
    --silent --show-error --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 60 \
    --retry 2 --retry-connrefused --retry-delay 15 \
    --header 'Accept: application/vnd.github+json' --header 'X-GitHub-Api-Version: 2022-11-28' \
    --dump-header - --output /dev/null --write-out '\n%{http_code}' "$token_url" 9>&-)" || status=$?
  token=''
  ((status == 0)) || return 0
  code="${response##*$'\n'}"
  case "$code" in
    200) ;;
    401 | 403) probe_result=rejected; return 0 ;;
    *) return 0 ;;
  esac
  # Case-insensitive, as HTTP/1.1 and HTTP/2 spell header names differently; a
  # new status line (a retried attempt, or a proxy's CONNECT answer, came first)
  # starts over, so only the last response's headers count.
  while IFS= read -r line; do
    line="${line%$'\r'}"
    if [[ "${line,,}" == http/* ]]; then
      has_header=0; value=''
    elif [[ "${line,,}" =~ ^github-authentication-token-expiration:[[:space:]]*(.*)$ ]]; then
      has_header=1; value="${BASH_REMATCH[1]^^}"
    fi
  done <<<"$response"
  if ((has_header == 0)); then
    probe_result=ok; probe_expires=never
    return 0
  fi
  # The shape is checked first: date -d also accepts words and the empty string.
  [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\ (UTC|[+-][0-9]{4})$ ]] || return 0
  value="$(date -u -d "$value" +%s 2>/dev/null)" || return 0
  [[ "$value" =~ $epoch_re ]] || return 0
  probe_result=ok; probe_expires="$value"
}

# token_write (monitor lock held, record directory checked, token_probe done)
# writes the record. Every result but ok keeps the previous good last_ok_epoch
# and expires_epoch. The clock is read here, after the probe.
token_write() {
  local now last_ok='' expires=''
  now="$(now_epoch)" || die 'cannot read the clock'
  [[ "$now" =~ $epoch_re ]] || die 'the system clock is unreadable'
  if read_record "$token_record" && [[ "${record[last_ok_epoch]:-}" =~ $epoch_re && "${record[expires_epoch]:-}" =~ ^(never|[1-9][0-9]{0,11})$ ]]; then
    last_ok="${record[last_ok_epoch]}"; expires="${record[expires_epoch]}"
  fi
  if [[ "$probe_result" == ok ]]; then last_ok="$now"; expires="$probe_expires"; fi
  if [[ ! -e "$drill_dir" ]]; then
    mkdir -m 0700 -- "$drill_dir" || install_fail "could not create $drill_dir"
  fi
  atomic_write "$token_record" 0600 "$(printf 'result=%s\nchecked_epoch=%s\nlast_ok_epoch=%s\nexpires_epoch=%s' "$probe_result" "$now" "$last_ok" "$expires")" \
    || install_fail "could not write $token_record"
}

# The probe can take minutes with retries, so it runs without the monitor lock:
# collect and drill commands, which do not wait for the lock, are never refused
# because of it. The lock is taken only for the read and write of the record.
cmd_token_check() {
  require_root
  require_command flock; require_command mktemp; require_command sync
  clean_path "$state_dir" MAWAREETH_RUNTIME_DIR
  clean_path "$token_file" MAWAREETH_GITHUB_TOKEN_FILE
  [[ "$token_lock_wait" =~ ^[0-9]{1,5}$ ]] || die 'MAWAREETH_TOKEN_LOCK_WAIT must be a number of seconds'
  [[ -d "$state_dir" && ! -L "$state_dir" ]] || die "runtime state directory $state_dir is missing; run deploy/runtime.sh prepare first"
  drill_check_dir
  token_probe
  exec 9>>"$monitor_lock_file" || die "cannot open $monitor_lock_file"
  if ! flock -w "$token_lock_wait" 9; then
    say "another monitor operation held $monitor_lock_file for ${token_lock_wait}s; nothing was recorded"
    exit 3
  fi
  drill_check_dir
  token_write
  say "token check recorded result=$probe_result in $token_record; the next collect publishes it"
}

# --- clear-sessions begin: the only part of this script that touches a container ---
# Anonymous interview cases live in database-backed Django sessions, and nothing
# else deletes them once they expire. The command runs in the container of the slot
# the persisted route serves, found by its Compose labels (the same way backup.sh
# finds PostgreSQL), so it needs no release manifest or runtime snapshot.
check_sessions_timeout() {
  [[ "$sessions_timeout" =~ ^[1-9][0-9]{0,3}$ ]] || die 'MAWAREETH_CLEAR_SESSIONS_TIMEOUT must be 1-9999 seconds'
}

cmd_clear_sessions() {
  require_root
  require_command docker; require_command timeout
  clean_path "$state_dir" MAWAREETH_RUNTIME_DIR
  check_sessions_timeout
  read_active_slot || die 'no persisted route exists; run deploy/runtime.sh prepare, then bootstrap with deploy/release.sh deploy'
  local ids
  ids="$(timeout 60 docker ps --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=app-$ACTIVE_SLOT" --format '{{.ID}}' 9>&-)" \
    || install_fail 'cannot list running containers'
  [[ "$ids" =~ ^[0-9a-f]{12,64}$ ]] || install_fail "expected exactly one running app-$ACTIVE_SLOT container, found: ${ids:-none}"
  # The inner timeout stops the work inside the container; the outer one stops docker itself.
  timeout --kill-after=5 "$((sessions_timeout + 30))" docker exec "$ids" timeout "$sessions_timeout" python manage.py clearsessions 9>&- \
    || install_fail "clearsessions failed in app-$ACTIVE_SLOT"
  say "cleared expired sessions in app-$ACTIVE_SLOT"
}

# unit_service in backup.sh runs backup.sh; this runs monitor.sh and needs Docker. A deploy
# can remove the container mid-run, so a failure retries (3 starts in 2 hours) and only a
# persistent one ends failed and alerts.
sessions_service_content() {
  printf '[Unit]\nDescription=Mawareeth expired session cleanup\nWants=network-online.target\nAfter=network-online.target docker.service\nRequires=docker.service\n'
  printf 'StartLimitIntervalSec=7200\nStartLimitBurst=3\n'
  printf '[Service]\nType=oneshot\nEnvironment=HOME=/root\nEnvironment=MAWAREETH_RUNTIME_DIR=%s\nEnvironment=MAWAREETH_CLEAR_SESSIONS_TIMEOUT=%s\n' "$state_dir" "$sessions_timeout"
  printf 'ExecStart=/bin/bash %s/monitor.sh clear-sessions\nTimeoutStartSec=%s\nNice=10\n' "$deploy_dir" "$((sessions_timeout + 120))"
  printf 'Restart=on-failure\nRestartSec=900\n'
}
# --- clear-sessions end ---

# --- Alert-path drill -------------------------------------------------------------
# Refusals (exit 2) happen before anything is written. Only a start creates the
# drill directory; confirm and abort never create anything. The record and its
# history line are written together: if the history append fails, the previous
# record is restored and the command exits 1.

# drill_check_dir refuses a drill directory that exists but is not a root:root
# 0700 directory.
drill_check_dir() {
  if [[ ! -e "$drill_dir" && ! -L "$drill_dir" ]]; then return 0; fi
  [[ -d "$drill_dir" && ! -L "$drill_dir" ]] || die "$drill_dir must be a directory; nothing was changed"
  [[ "$(stat -c '%u:%g:%a' "$drill_dir" 2>/dev/null)" == 0:0:700 ]] || die "$drill_dir must be root:root mode 0700; nothing was changed"
}

# drill_check_history refuses a history path that exists but is not a
# root:root 0600 regular file.
drill_check_history() {
  if [[ ! -e "$drill_history_file" && ! -L "$drill_history_file" ]]; then return 0; fi
  [[ -f "$drill_history_file" && ! -L "$drill_history_file" ]] || die "$drill_history_file must be a regular file; nothing was changed"
  [[ "$(stat -c '%u:%g:%a' "$drill_history_file" 2>/dev/null)" == 0:0:600 ]] || die "$drill_history_file must be root:root mode 0600; nothing was changed"
}

# drill_load fills drill[] and drill_previous from the record (idle and empty
# when there is none). An unusable or inconsistent record is refused, never
# overwritten.
drill_load() {
  declare -gA drill=([state]=idle [code]='' [started_epoch]='' [last_result]='' [last_pass_epoch]='' [last_pass_at]='')
  drill_previous=''; drill_had_record=0
  if [[ ! -e "$drill_file" && ! -L "$drill_file" ]]; then return 0; fi
  local unusable="the drill record $drill_file is unusable; inspect it and move it aside; nothing was changed"
  read_record "$drill_file" || die "$unusable (it must be a root:root 0600 file of key=value lines)"
  local key
  for key in state code started_epoch last_result last_pass_epoch last_pass_at; do drill[$key]="${record[$key]:-}"; done
  case "${drill[state]}" in
    active) [[ "${drill[code]}" =~ $drill_code_re ]] || die "$unusable (an active drill needs a six-digit code)" ;;
    idle) [[ -z "${drill[code]}" ]] || die "$unusable (an idle drill must have no code)" ;;
    *) die "$unusable (unknown state)" ;;
  esac
  for key in started_epoch last_pass_epoch; do
    [[ -z "${drill[$key]}" || "${drill[$key]}" =~ $epoch_re ]] || die "$unusable ($key is not a plain epoch)"
  done
  case "${drill[last_result]}" in '' | pass | aborted) ;; *) die "$unusable (unknown last_result)" ;; esac
  drill_previous="$(cat -- "$drill_file")" || die "$unusable"
  drill_had_record=1
}

drill_content() {
  printf 'state=%s\ncode=%s\nstarted_epoch=%s\nlast_result=%s\nlast_pass_epoch=%s\nlast_pass_at=%s' \
    "${drill[state]}" "${drill[code]}" "${drill[started_epoch]}" "${drill[last_result]}" "${drill[last_pass_epoch]}" "${drill[last_pass_at]}"
}

# drill_commit EVENT CODE writes the record, then appends the history line
# (created under umask 077); a failed append restores the previous record and
# trims the history back to its previous length.
drill_commit() {
  local operator="${SUDO_USER:-root}" history_size=''
  operator="${operator//[^A-Za-z0-9._-]/_}"
  if [[ -e "$drill_history_file" ]]; then
    history_size="$(stat -c %s -- "$drill_history_file")" && [[ "$history_size" =~ ^[0-9]+$ ]]       || die "cannot read the size of $drill_history_file; nothing was changed"
  fi
  atomic_write "$drill_file" 0600 "$(drill_content)" || install_fail "could not write $drill_file; the drill state was not changed"
  if (umask 077 && printf 'at=%s event=%s code=%s started_epoch=%s by=%s\n' "$drill_iso" "$1" "$2" "${drill[started_epoch]}" "$operator" \
    >> "$drill_history_file" && sync -- "$drill_history_file"); then
    return 0
  fi
  if [[ -n "$history_size" ]]; then
    truncate -s "$history_size" -- "$drill_history_file" || say "could not trim $drill_history_file back; its last line may describe a change that was undone"
  else
    rm -f -- "$drill_history_file" || say "could not remove the new $drill_history_file"
  fi
  if [[ "$drill_had_record" == 1 ]]; then
    atomic_write "$drill_file" 0600 "$drill_previous" || install_fail "could not append to $drill_history_file and could not restore $drill_file; inspect both"
  else
    rm -f -- "$drill_file" || install_fail "could not append to $drill_history_file and could not remove the new $drill_file; inspect both"
  fi
  install_fail "could not append to $drill_history_file; the drill record was restored and the drill state was not changed"
}

# The drill state is already committed here, so a failed publish exits 1, not
# 2: the next timed collect publishes it.
drill_publish() {
  local content
  if content="$(render_metrics)" && atomic_write "$prom_file" 0644 "${content%$'\n'}"; then return 0; fi
  install_fail "the drill state WAS changed, but $prom_file could not be written; the drill metrics publish at the next collect (within 5 minutes)"
}

# A code in 100000-999999 from four bytes of /dev/urandom.
drill_new_code() {
  local random
  random="$(od -An -N4 -tu4 /dev/urandom)" || die 'cannot read /dev/urandom; nothing was changed'
  random="${random//[[:space:]]/}"
  [[ "$random" =~ ^[0-9]{1,10}$ ]] || die 'cannot read /dev/urandom; nothing was changed'
  drill_new=$((100000 + 10#$random % 900000))
}

cmd_drill() {
  require_root
  local action="${1:-}" code=''
  case "$action" in
    start | abort) (($# == 1)) || die "$drill_usage" ;;
    confirm)
      (($# >= 2 && $# <= 3)) || die "$drill_usage"
      code="$2"
      [[ "$code" =~ $drill_code_re ]] || die 'the code must be the six digits from the MawareethAlertDrill email; nothing was changed'
      [[ "${3:-}" == --better-stack-received ]] \
        || die 'send the Better Stack test notification first and pass --better-stack-received once it has arrived; nothing was changed'
      ;;
    *) die "$drill_usage" ;;
  esac
  require_command flock; require_command mktemp; require_command sync; require_command od; require_command truncate
  clean_path "$state_dir" MAWAREETH_RUNTIME_DIR
  clean_path "$textfile_dir" MAWAREETH_TEXTFILE_DIR
  acquire_monitor_lock
  check_textfile_dir
  drill_check_dir
  drill_load
  local now
  now="$(now_epoch)" || die 'cannot read the clock; nothing was changed'
  [[ "$now" =~ $epoch_re ]] || die 'the system clock is unreadable; nothing was changed'
  drill_iso="$(date -u -d "@$now" +%Y-%m-%dT%H:%M:%SZ)" || die 'cannot read the clock; nothing was changed'
  case "$action" in
    start)
      [[ "${drill[state]}" != active ]] || die 'a drill is already active; confirm or abort it first; nothing was changed'
      drill_check_history
      drill_new_code
      if [[ ! -e "$drill_dir" ]]; then
        mkdir -m 0700 -- "$drill_dir" || die "could not create $drill_dir; nothing was changed"
        drill_check_dir
      fi
      drill[state]=active; drill[code]="$drill_new"; drill[started_epoch]="$now"
      drill_commit start "$drill_new"; drill_publish
      printf 'drill started; code %s\n' "$drill_new"
      say "expect '[MAWAREETH info] MawareethAlertDrill' carrying this code within about 10 minutes; also send the Better Stack test notification, then run: monitor.sh drill confirm <code from the email> --better-stack-received"
      ;;
    confirm)
      [[ "${drill[state]}" == active ]] || die 'no drill is active; nothing was changed'
      [[ "${drill[code]}" == "$code" ]] || die 'the code does not match the active drill; nothing was changed'
      drill_check_history
      drill[state]=idle; drill[code]=''; drill[last_result]=pass; drill[last_pass_epoch]="$now"; drill[last_pass_at]="$drill_iso"
      drill_commit pass "$code"; drill_publish
      say "drill passed at $drill_iso; a resolved email follows"
      ;;
    abort)
      [[ "${drill[state]}" == active ]] || die 'no drill is active; nothing was changed'
      drill_check_history
      code="${drill[code]}"
      drill[state]=idle; drill[code]=''; drill[last_result]=aborted
      drill_commit aborted "$code"; drill_publish
      say 'drill aborted; the last pass is unchanged'
      ;;
  esac
}

# The exporter is started through this wrapper so it binds only the Tailscale
# IPv4. Without one it exits 1 and systemd retries every 15s; it never falls
# back to another address.
exporter_wrapper_content() {
  cat <<EOF
#!/bin/bash
set -Eeuo pipefail
ip="\$(/usr/bin/tailscale ip -4 2>/dev/null | head -n 1)" || ip=''
if [[ ! "\$ip" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}\$ ]]; then
  printf 'mawareeth-node-exporter: no Tailscale IPv4 address; refusing to listen anywhere else\n' >&2
  exit 1
fi
exec /usr/bin/prometheus-node-exporter --web.listen-address="\$ip:9100" --collector.textfile.directory=$textfile_dir --collector.systemd
EOF
}

exporter_dropin_content() {
  printf '[Unit]\nAfter=tailscaled.service\nWants=tailscaled.service\nStartLimitIntervalSec=0\n'
  printf '[Service]\nRestart=always\nRestartSec=15\nExecStart=\nExecStart=%s\n' "$exporter_wrapper"
}

journald_content() {
  printf '[Journal]\nSystemMaxUse=500M\nSystemKeepFree=1G\nMaxRetentionSec=30day\n'
}

collect_service_content() {
  printf '[Unit]\nDescription=Mawareeth monitoring textfile collector\n'
  printf '[Service]\nType=oneshot\nEnvironment=MAWAREETH_RUNTIME_DIR=%s\nEnvironment=MAWAREETH_TEXTFILE_DIR=%s\nEnvironment=MAWAREETH_ORIGIN_TLS_DIR=%s\n' "$state_dir" "$textfile_dir" "$origin_tls_dir"
  printf 'ExecStart=/bin/bash %s/monitor.sh collect\nTimeoutStartSec=120\nNice=10\n' "$deploy_dir"
}

# unit_service in backup.sh requires the container runtime; this needs only the
# network.
token_service_content() {
  printf '[Unit]\nDescription=Mawareeth GitHub read token check\nWants=network-online.target\nAfter=network-online.target\n'
  printf '[Service]\nType=oneshot\nEnvironment=MAWAREETH_RUNTIME_DIR=%s\nEnvironment=MAWAREETH_GITHUB_TOKEN_FILE=%s\n' "$state_dir" "$token_file"
  printf 'ExecStart=/bin/bash %s/monitor.sh token-check\nTimeoutStartSec=360\nNice=10\n' "$deploy_dir"
}

cmd_install() {
  require_root
  local tool
  for tool in apt-get curl systemctl ufw timeout flock mktemp sync install; do require_command "$tool"; done
  clean_path "$deploy_dir" 'the deployment checkout'
  clean_path "$state_dir" MAWAREETH_RUNTIME_DIR
  check_sessions_timeout
  clean_path "$textfile_dir" MAWAREETH_TEXTFILE_DIR
  clean_path "$systemd_dir" MAWAREETH_SYSTEMD_DIR
  clean_path "$journald_dir" MAWAREETH_JOURNALD_DIR
  clean_path "$apt_dir" MAWAREETH_APT_DIR
  clean_path "$sbin_dir" MAWAREETH_SBIN_DIR
  clean_path "$origin_tls_dir" MAWAREETH_ORIGIN_TLS_DIR
  clean_path "$token_file" MAWAREETH_GITHUB_TOKEN_FILE
  [[ -r "$os_release_file" ]] || die 'cannot determine the operating system'
  local os_id os_version
  os_id="$(sed -n 's/^ID=//p' "$os_release_file" | tr -d '"')"
  os_version="$(sed -n 's/^VERSION_ID=//p' "$os_release_file" | tr -d '"')"
  [[ "$os_id" == ubuntu && "$os_version" == 24.04 ]] || die 'Ubuntu 24.04 (noble) is required'
  local dir
  for dir in "$systemd_dir" "$apt_dir"; do
    [[ -d "$dir" && ! -L "$dir" ]] || die "$dir must be a directory"
  done
  acquire_monitor_lock
  drill_check_dir
  # The 9100 rule below would enforce nothing on an inactive UFW; check first
  # so nothing is installed on an unfiltered host.
  local ufw_status
  ufw_status="$(timeout 60 ufw status)" || install_fail 'could not read the UFW status'
  [[ "$(head -n 1 <<<"$ufw_status")" == 'Status: active' ]] || install_fail 'UFW is not active; run deploy/bootstrap-host.sh (provision-host.sh) first'

  # Exporter: Tailscale IPv4 only, textfile collector on, restart every 15s.
  # Written and loaded before the package is installed, so the package's own
  # first start already uses the wrapper and never listens on all addresses.
  install -d -m 0755 "$sbin_dir" "$exporter_dropin_dir" || install_fail 'could not create the exporter directories'
  atomic_write "$exporter_wrapper" 0755 "$(exporter_wrapper_content)" || install_fail "could not write $exporter_wrapper"
  atomic_write "$exporter_dropin_dir/10-mawareeth.conf" 0644 "$(exporter_dropin_content)" || install_fail 'could not write the exporter drop-in'
  timeout 60 systemctl daemon-reload || install_fail 'systemctl daemon-reload failed'

  # Tailscale from its official signed noble repository; node_exporter from
  # the (signed) Ubuntu archive.
  install -d -m 0755 "$apt_dir/keyrings" "$apt_dir/sources.list.d" || install_fail 'could not create the apt directories'
  local keyring="$apt_dir/keyrings/tailscale-archive-keyring.gpg" key_tmp
  key_tmp="$(mktemp "$apt_dir/keyrings/.tmp.XXXXXX")" || install_fail 'could not allocate a temporary keyring'
  if ! timeout 120 curl -fsSL --proto '=https' --tlsv1.2 -o "$key_tmp" "$tailscale_key_url" || [[ ! -s "$key_tmp" ]]; then
    rm -f -- "$key_tmp"; install_fail "could not download the Tailscale signing key from $tailscale_key_url"
  fi
  if ! { chmod 0644 "$key_tmp" && mv -f -- "$key_tmp" "$keyring"; }; then rm -f -- "$key_tmp"; install_fail 'could not install the Tailscale keyring'; fi
  atomic_write "$apt_dir/sources.list.d/tailscale.list" 0644 "deb [signed-by=$keyring] $tailscale_repo" || install_fail 'could not write tailscale.list'
  export DEBIAN_FRONTEND=noninteractive
  timeout 600 apt-get update || install_fail 'apt-get update failed'
  timeout 900 apt-get install -y --no-install-recommends tailscale prometheus-node-exporter || install_fail 'could not install tailscale and prometheus-node-exporter'
  [[ -e "$textfile_dir" ]] || install -d -m 0755 "$textfile_dir" || install_fail "could not create $textfile_dir"
  check_textfile_dir

  # journald bounds; container logs are already bounded by the Compose file.
  install -d -m 0755 "$journald_dir" || install_fail "could not create $journald_dir"
  atomic_write "$journald_dir/50-mawareeth.conf" 0644 "$(journald_content)" || install_fail 'could not write the journald drop-in'

  # Only p1's tailnet range may reach 9100, and only over tailscale0 (UFW was
  # checked active above).
  ufw "${ufw_rule[@]}" || install_fail 'could not add the tailscale0 UFW rule for node_exporter'
  # Administrative SSH over the tailnet, so access survives a change of the
  # operator's public address. The public allow-list stays as a fallback.
  ufw "${ssh_ufw_rule[@]}" || install_fail 'could not add the tailscale0 UFW rule for SSH'

  atomic_write "$systemd_dir/$collect_unit.service" 0644 "$(collect_service_content)" || install_fail "could not write $collect_unit.service"
  atomic_write "$systemd_dir/$collect_unit.timer" 0644 "$(unit_timer 'Mawareeth monitoring collector every 5 minutes' '*:0/5' '' "$collect_unit.service")" \
    || install_fail "could not write $collect_unit.timer"
  atomic_write "$systemd_dir/$token_unit.service" 0644 "$(token_service_content)" || install_fail "could not write $token_unit.service"
  atomic_write "$systemd_dir/$token_unit.timer" 0644 "$(unit_timer 'Mawareeth GitHub read token check every day' daily 1h "$token_unit.service")" \
    || install_fail "could not write $token_unit.timer"
  atomic_write "$systemd_dir/$sessions_unit.service" 0644 "$(sessions_service_content)" || install_fail "could not write $sessions_unit.service"
  atomic_write "$systemd_dir/$sessions_unit.timer" 0644 "$(unit_timer 'Mawareeth expired session cleanup every day' daily 1h "$sessions_unit.service")" \
    || install_fail "could not write $sessions_unit.timer"

  # Publishes the token series on the first file; a host whose token is not
  # installed yet records missing and alerts until it is.
  token_probe
  token_write
  publish_metrics
  timeout 60 systemctl daemon-reload || install_fail 'systemctl daemon-reload failed'
  timeout 60 systemctl restart systemd-journald || install_fail 'could not restart systemd-journald'
  timeout 60 systemctl enable --now tailscaled.service || install_fail 'could not enable tailscaled'
  timeout 60 systemctl enable "$exporter_unit" || install_fail "could not enable $exporter_unit"
  # Starts asynchronously: until `tailscale up` has run, the exporter retries.
  timeout 60 systemctl restart --no-block "$exporter_unit" || install_fail "could not restart $exporter_unit"
  timeout 60 systemctl enable --now "$collect_unit.timer" || install_fail "could not enable $collect_unit.timer"
  timeout 60 systemctl enable --now "$token_unit.timer" || install_fail "could not enable $token_unit.timer"
  timeout 60 systemctl enable --now "$sessions_unit.timer" || install_fail "could not enable $sessions_unit.timer"
  say "installed; join the tailnet with 'sudo tailscale up' if not done yet, then add the p1 snippets (deploy/README.md)"
}

monitor_main() {
  trap '' PIPE
  case "${1:-}" in
    install) cmd_install ;;
    collect) cmd_collect ;;
    status) cmd_status ;;
    token-check) cmd_token_check ;;
    clear-sessions) cmd_clear_sessions ;;
    drill) shift; cmd_drill "$@" ;;
    *) die 'usage: monitor.sh {install|collect|token-check|clear-sessions|status|drill}' ;;
  esac
}

monitor_main "$@"
