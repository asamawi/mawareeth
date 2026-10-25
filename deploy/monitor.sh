#!/usr/bin/env bash
# Host monitoring for the shared SCDF Prometheus/Alertmanager on p1.
#
#   sudo deploy/monitor.sh install   Tailscale, node_exporter on the Tailscale
#                                    IPv4 only, UFW, journald bounds, collector
#   sudo deploy/monitor.sh collect   publish backup/restore records as metrics
#                                    (including whether the last ok backup
#                                    holds every archive)
#   sudo deploy/monitor.sh status    print the metrics a collect would publish
#                                    and the drill record
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
# record's metrics are published as 0 so the matching alert fires. Staleness is
# judged by the Prometheus rules (time() - metric); this script never compares
# clocks. It never takes the deploy or backup locks and never touches slots,
# routes, the deploy journal, snapshots, or the database. Tailscale is joined
# interactively by the operator (deploy/README.md); no auth key is accepted.
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
epoch_re='^[1-9][0-9]{0,11}$'
drill_code_re='^[1-9][0-9]{5}$'
drill_dir="$state_dir/monitor"
drill_file="$drill_dir/drill"
drill_history_file="$drill_dir/drill-history"
drill_usage='usage: monitor.sh drill {start|confirm CODE --better-stack-received|abort}'

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

# archives_metric sets archives_complete from the backup record that
# record_metrics just read: 1 only when that record is usable and ok and its
# host_state_snapshot and globals_snapshot are both Restic IDs (64 hex), so a
# run made by an older backup.sh, or a regression, is noticed.
archives_metric() {
  archives_complete=0
  ((metric_ok == 1)) || return 0
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
  acquire_monitor_lock
  check_textfile_dir
  publish_metrics
}

cmd_status() {
  require_root
  clean_path "$state_dir" MAWAREETH_RUNTIME_DIR
  clean_path "$textfile_dir" MAWAREETH_TEXTFILE_DIR
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
}

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
exec /usr/bin/prometheus-node-exporter --web.listen-address="\$ip:9100" --collector.textfile.directory=$textfile_dir
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
  printf '[Service]\nType=oneshot\nEnvironment=MAWAREETH_RUNTIME_DIR=%s\nEnvironment=MAWAREETH_TEXTFILE_DIR=%s\n' "$state_dir" "$textfile_dir"
  printf 'ExecStart=/bin/bash %s/monitor.sh collect\nTimeoutStartSec=120\nNice=10\n' "$deploy_dir"
}

cmd_install() {
  require_root
  local tool
  for tool in apt-get curl systemctl ufw timeout flock mktemp sync install; do require_command "$tool"; done
  clean_path "$deploy_dir" 'the deployment checkout'
  clean_path "$state_dir" MAWAREETH_RUNTIME_DIR
  clean_path "$textfile_dir" MAWAREETH_TEXTFILE_DIR
  clean_path "$systemd_dir" MAWAREETH_SYSTEMD_DIR
  clean_path "$journald_dir" MAWAREETH_JOURNALD_DIR
  clean_path "$apt_dir" MAWAREETH_APT_DIR
  clean_path "$sbin_dir" MAWAREETH_SBIN_DIR
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

  atomic_write "$systemd_dir/$collect_unit.service" 0644 "$(collect_service_content)" || install_fail "could not write $collect_unit.service"
  atomic_write "$systemd_dir/$collect_unit.timer" 0644 "$(unit_timer 'Mawareeth monitoring collector every 5 minutes' '*:0/5' '' "$collect_unit.service")" \
    || install_fail "could not write $collect_unit.timer"

  publish_metrics
  timeout 60 systemctl daemon-reload || install_fail 'systemctl daemon-reload failed'
  timeout 60 systemctl restart systemd-journald || install_fail 'could not restart systemd-journald'
  timeout 60 systemctl enable --now tailscaled.service || install_fail 'could not enable tailscaled'
  timeout 60 systemctl enable "$exporter_unit" || install_fail "could not enable $exporter_unit"
  # Starts asynchronously: until `tailscale up` has run, the exporter retries.
  timeout 60 systemctl restart --no-block "$exporter_unit" || install_fail "could not restart $exporter_unit"
  timeout 60 systemctl enable --now "$collect_unit.timer" || install_fail "could not enable $collect_unit.timer"
  say "installed; join the tailnet with 'sudo tailscale up' if not done yet, then add the p1 snippets (deploy/README.md)"
}

monitor_main() {
  trap '' PIPE
  case "${1:-}" in
    install) cmd_install ;;
    collect) cmd_collect ;;
    status) cmd_status ;;
    drill) shift; cmd_drill "$@" ;;
    *) die 'usage: monitor.sh {install|collect|status|drill}' ;;
  esac
}

monitor_main "$@"
