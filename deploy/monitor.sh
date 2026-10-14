#!/usr/bin/env bash
# Host monitoring for the shared SCDF Prometheus/Alertmanager on p1.
#
#   sudo deploy/monitor.sh install   Tailscale, node_exporter on the Tailscale
#                                    IPv4 only, UFW, journald bounds, collector
#   sudo deploy/monitor.sh collect   publish backup/restore records as metrics
#   sudo deploy/monitor.sh status    print the metrics a collect would publish
#
# Exit codes: 0 success; 1 an install step failed; 2 refused (invalid input,
# environment, or usage); 3 another monitor operation holds the monitor lock.
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
  record_metrics "$evidence_file" result pass verified_epoch
  gauge mawareeth_restore_last_pass_timestamp_seconds 'Verification time of the last restore check when it passed; 0 if the record is unusable or not pass.' "$metric_ts"
  gauge mawareeth_restore_last_result_pass '1 when the last restore verification record is usable and its result is pass.' "$metric_ok"
  gauge mawareeth_monitor_collect_timestamp_seconds 'Time this file was last written by monitor.sh collect.' "$now"
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
    *) die 'usage: monitor.sh {install|collect|status}' ;;
  esac
}

monitor_main "$@"
