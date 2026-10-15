#!/usr/bin/env bash
# shellcheck disable=SC2016 # literal $ patterns are intentional in assertions.
# Offline tests for deploy/monitor.sh and deploy/monitoring/*.yml. apt-get,
# curl, ufw, systemctl, tailscale, the exporter binary, and (when absent or
# unprivileged) flock, stat, and sync are stubbed; nothing touches the network,
# systemd, the firewall, a tailnet, p1, or this checkout. When promtool is
# installed the alert rules are also checked and unit-tested against every
# row of the spec's I/O matrix.
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
fail() { printf 'FAIL: %s\n' "$*" >&2; [[ ! -f "${tmp:-}/out" ]] || sed 's/^/  | /' "$tmp/out" >&2; exit 1; }
need() { grep -Fq -- "$2" "$1" || fail "missing $2 in $1"; }
lacks() { ! grep -Fq -- "$2" "$1" || fail "unexpected $2 in $1"; }

monitor_src="$root/deploy/monitor.sh"
alerts="$root/deploy/monitoring/mawareeth-alerts.yml"
scrape="$root/deploy/monitoring/prometheus-scrape.yml"
route="$root/deploy/monitoring/alertmanager-route.yml"
bash -n "$monitor_src" "$root/deploy/backup.sh" "$root/deploy/runtime.sh" "$0"
! grep -Eq '\|\|[[:space:]]*(true|:)([[:space:]]|$|;)' "$monitor_src" || fail 'monitor.sh must not mask failures with || true'
! grep -Eq 'acquire_deploy_lock|deploy_lock_file|journal_file|route_file|slots_dir|write_snapshot|routes_dir|acquire_backup_lock|backup_lock_file|docker|compose' "$monitor_src" \
  || fail 'monitor.sh must not take the deploy or backup locks or touch slots, routes, the journal, snapshots, containers, or the database'
! grep -Eiq 'authkey|auth-key|SMTP_PASS|smtp_auth_password' "$monitor_src" "$alerts" "$scrape" "$route" || fail 'no Tailscale or SMTP secret may appear in the repository'
! grep -Eq '0\.0\.0\.0|\[::\]' "$monitor_src" || fail 'monitor.sh must never mention a wildcard listen address'

real_stat="$(command -v stat)"; real_flock="$(command -v flock 2>/dev/null || true)"; real_sync="$(command -v sync)"
tmp="$(mktemp -d)"; [[ -z "${KEEP_TMP:-}" ]] || echo "$tmp" >&2
case "$tmp" in "$root"/*) fail 'temporary directory must be outside the checkout' ;; esac
trap '[[ -n "${KEEP_TMP:-}" ]] || rm -rf "$tmp"' EXIT
stub="$tmp/bin"; S="$tmp/stub-state"; state="$tmp/state"; bundle="$tmp/bundle"; units="$tmp/systemd"
textfile="$tmp/textfile"; journald="$tmp/journald.conf.d"; apt="$tmp/apt"; sbin="$tmp/sbin"
mkdir -p "$stub" "$S" "$state/backup" "$bundle/deploy" "$units" "$textfile" "$apt"
printf 'ID=ubuntu\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\n' > "$tmp/os-release"

# A disposable bundle; only the root execution gate is relaxed when unprivileged.
cp "$root/deploy/runtime-images.lock" "$bundle/deploy/"
for script in runtime.sh backup.sh monitor.sh; do
  if [[ ${EUID:-999} -ne 0 ]]; then
    sed 's/\[\[ ${EUID:-999} -eq 0 \]\]/[[ 0 -eq 0 ]]/' "$root/deploy/$script" > "$bundle/deploy/$script"
    ! grep -Fq 'EUID' "$bundle/deploy/$script" || fail "root-gate patch was not applied to $script"
  else
    cp "$root/deploy/$script" "$bundle/deploy/$script"
  fi
done
monitor="$bundle/deploy/monitor.sh"; backup="$bundle/deploy/backup.sh"

# Every stubbed command appends its argv to calls.log.
# shellcheck disable=SC2043 # single-entry list kept so more stubs can be added.
for command in systemctl; do
  printf '#!/usr/bin/env bash\nprintf %%s\\\\n "%s $*" >> %q\n' "$command" "$S/calls.log" > "$stub/$command"
done
# ufw reports active unless "$S/ufw-inactive" exists.
cat > "$stub/ufw" <<EOF
#!/usr/bin/env bash
printf '%s\n' "ufw \$*" >> '$S/calls.log'
if [[ "\$*" == status ]]; then
  if [[ -e '$S/ufw-inactive' ]]; then printf 'Status: inactive\n'; else printf 'Status: active\n\nTo Action From\n'; fi
fi
EOF
# apt-get also records whether the exporter drop-in already existed.
cat > "$stub/apt-get" <<EOF
#!/usr/bin/env bash
printf '%s\n' "apt-get \$*" >> '$S/calls.log'
[[ ! -e '$units/prometheus-node-exporter.service.d/10-mawareeth.conf' ]] || printf 'apt-get saw the exporter drop-in\n' >> '$S/calls.log'
EOF
cat > "$stub/curl" <<EOF
#!/usr/bin/env bash
printf '%s\n' "curl \$*" >> '$S/calls.log'
[[ ! -e '$S/curl-fails' ]] || exit 22
while (( \$# )); do if [[ "\$1" == -o ]]; then printf 'stub-keyring\n' > "\$2"; fi; shift; done
EOF
cat > "$stub/tailscale" <<EOF
#!/usr/bin/env bash
printf '%s\n' "tailscale \$*" >> '$S/calls.log'
[[ "\$*" == 'ip -4' && -e '$S/tailscale-ip' ]] || exit 1
cat '$S/tailscale-ip'
EOF
cat > "$stub/exporter" <<EOF
#!/usr/bin/env bash
printf '%s\n' "exporter \$*" >> '$S/calls.log'
EOF
if [[ -z "$real_flock" ]]; then
  printf '#!/usr/bin/env bash\n[[ ! -e %q ]]\n' "$S/lock-held" > "$stub/flock"
fi
printf 'probe\n' > "$tmp/sync-probe"
if ! "$real_sync" -- "$tmp/sync-probe" 2>/dev/null; then printf '#!/usr/bin/env bash\nexit 0\n' > "$stub/sync"; fi
chmod 600 "$tmp/sync-probe"; modes_work=0
[[ "$("$real_stat" -c %a "$tmp/sync-probe")" != 600 ]] || modes_work=1
# Unprivileged runs report root ownership with the modes root would establish;
# "$S/mode-<basename>" overrides one file.
if [[ ${EUID:-999} -ne 0 ]]; then
  cat > "$stub/stat" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == -c && "\$2" == '%u:%g:%a' ]]; then
  if [[ -e "$S/mode-\${3##*/}" ]]; then cat "$S/mode-\${3##*/}"; exit 0; fi
  [[ -e "\$3" ]] || exit 1
  if [[ -d "\$3" ]]; then printf '0:0:700\n'; else printf '0:0:600\n'; fi
else
  exec '$real_stat' "\$@"
fi
EOF
fi
chmod +x "$stub"/*

base_env=(PATH="$stub:$PATH" MAWAREETH_RUNTIME_DIR="$state" MAWAREETH_SYSTEMD_DIR="$units" MAWAREETH_TEXTFILE_DIR="$textfile"
  MAWAREETH_JOURNALD_DIR="$journald" MAWAREETH_APT_DIR="$apt" MAWAREETH_SBIN_DIR="$sbin" MAWAREETH_OS_RELEASE="$tmp/os-release")
rc=0
# run SCRIPT [ENV=VALUE...] COMMAND
run() {
  local script="$1"; shift
  : > "$S/calls.log"
  set +e
  env "${base_env[@]}" "${@:1:$#-1}" bash "$script" "${@: -1}" > "$tmp/out" 2>&1
  rc=$?
  set -e
}
expect_rc() { [[ "$rc" == "$1" ]] || fail "$2: expected exit $1, got $rc"; }
prom="$textfile/mawareeth.prom"
metric() { awk -v name="$1" '$1 == name { print $2 }' "$prom"; }
expect_metric() { [[ "$(metric "$1")" == "$2" ]] || fail "$3: $1 is $(metric "$1"), expected $2"; }
now="$(date -u +%s)"

# set_meta FILE UID:GID:MODE makes read_record see that ownership and mode.
set_meta() {
  rm -f "$S/mode-${1##*/}"
  if [[ ${EUID:-999} -eq 0 ]]; then
    chown "${2%:*}" "$1"; chmod "${2##*:}" "$1"
  elif [[ "$2" != 0:0:600 ]]; then
    printf '%s\n' "$2" > "$S/mode-${1##*/}"
  fi
}
write_record() { printf '%s\n' "$2" > "$1"; chmod 600 "$1"; set_meta "$1" 0:0:600; }
backup_rec="$state/backup/last-backup"; restore_rec="$state/backup/restore-verified"
healthy_records() {
  write_record "$backup_rec" "result=ok"$'\n'"run=20261014T023000Z"$'\n'"finished_epoch=$((now - 3600))"
  write_record "$restore_rec" "result=pass"$'\n'"verified_epoch=$((now - 86400))"
}

# --- backup.sh still works when executed directly, and sources cleanly ---------
run "$backup" ''
expect_rc 2 'backup.sh without a command'; need "$tmp/out" 'usage: backup.sh'
run "$backup" status
expect_rc 0 'backup.sh status executed directly'; need "$tmp/out" '== gate'
set +e
env "${base_env[@]}" bash -c 'source "$1"; declare -F read_record >/dev/null && printf "sourced-without-main\n"' _ "$backup" > "$tmp/out" 2>&1; rc=$?
set -e
expect_rc 0 'sourcing backup.sh'; need "$tmp/out" 'sourced-without-main'
lacks "$tmp/out" 'usage: backup.sh'

# --- Collector: every record row of the matrix ----------------------------------
run "$monitor" bogus; expect_rc 2 'unknown command'; need "$tmp/out" 'usage: monitor.sh'

healthy_records
run "$monitor" collect
expect_rc 0 'healthy collect'
expect_metric mawareeth_backup_last_result_ok 1 healthy
expect_metric mawareeth_backup_last_ok_timestamp_seconds "$((now - 3600))" healthy
expect_metric mawareeth_restore_last_result_pass 1 healthy
expect_metric mawareeth_restore_last_pass_timestamp_seconds "$((now - 86400))" healthy
collected="$(metric mawareeth_monitor_collect_timestamp_seconds)"
# shellcheck disable=SC2015 # fail exits, so it runs only when the check fails.
[[ "$collected" =~ ^[1-9][0-9]+$ ]] && (( collected >= now && collected <= now + 120 )) || fail "collect timestamp $collected is not the current time"

# Prom text format: HELP, TYPE gauge, then one sample, for exactly five metrics.
[[ "$(grep -c '^# TYPE .* gauge$' "$prom")" == 5 ]] || fail 'expected five gauges'
[[ "$(grep -vc '^#' "$prom")" == 5 ]] || fail 'expected five samples'
while read -r name; do
  [[ "$(grep -A2 -x "# HELP $name .*" "$prom" | sed -n 2,3p)" == "# TYPE $name gauge"$'\n'"$name "* ]] || fail "$name lacks HELP/TYPE/sample order"
done < <(grep -v '^#' "$prom" | cut -d' ' -f1)
! grep -vE '^(# (HELP|TYPE) mawareeth_[a-z_]+ .+|mawareeth_[a-z_]+ (0|[1-9][0-9]*))$' "$prom" || fail 'mawareeth.prom has a malformed line'
[[ "$(tail -c 1 "$prom" | od -An -c | tr -d ' ')" == '\n' ]] || fail 'mawareeth.prom must end with a newline'
[[ -z "$(find "$textfile" -name '.tmp.*' -print -quit)" ]] || fail 'collect left a temporary file in the textfile directory'
if (( modes_work )); then [[ "$("$real_stat" -c %a "$prom")" == 644 ]] || fail 'mawareeth.prom must be mode 0644'; fi

# Backup bad: failed result; old-but-ok keeps its age for the rule to judge.
write_record "$backup_rec" "result=failed:dump"$'\n'"finished_epoch=$((now - 60))"
run "$monitor" collect; expect_rc 0 'failed backup collect'
expect_metric mawareeth_backup_last_result_ok 0 'failed backup'
expect_metric mawareeth_backup_last_ok_timestamp_seconds 0 'failed backup'
expect_metric mawareeth_restore_last_result_pass 1 'failed backup leaves restore healthy'
write_record "$backup_rec" "result=ok"$'\n'"finished_epoch=$((now - 27 * 3600))"
run "$monitor" collect; expect_rc 0 'old backup collect'
expect_metric mawareeth_backup_last_result_ok 1 'old backup'
expect_metric mawareeth_backup_last_ok_timestamp_seconds "$((now - 27 * 3600))" 'old backup'

# Restore bad likewise.
healthy_records
write_record "$restore_rec" "result=fail:count-mismatch"$'\n'"verified_epoch=$((now - 60))"
run "$monitor" collect; expect_rc 0 'failed restore collect'
expect_metric mawareeth_restore_last_result_pass 0 'failed restore'
expect_metric mawareeth_restore_last_pass_timestamp_seconds 0 'failed restore'
expect_metric mawareeth_backup_last_result_ok 1 'failed restore leaves backup healthy'
write_record "$restore_rec" "result=pass"$'\n'"verified_epoch=$((now - 36 * 86400))"
run "$monitor" collect; expect_rc 0 'old restore collect'
expect_metric mawareeth_restore_last_pass_timestamp_seconds "$((now - 36 * 86400))" 'old restore'

# Record unusable: absent, wrong mode, wrong owner, symlink, bad line, bad epoch.
unusable() {
  local label="$1"
  run "$monitor" collect
  expect_rc 0 "$label collect"
  expect_metric mawareeth_backup_last_result_ok 0 "$label"
  expect_metric mawareeth_backup_last_ok_timestamp_seconds 0 "$label"
  healthy_records
}
healthy_records; rm -f "$backup_rec"; unusable 'absent record'
set_meta "$backup_rec" 0:0:644; unusable 'world-readable record'
set_meta "$backup_rec" 1000:1000:600; unusable 'mis-owned record'
rm -f "$backup_rec"; printf 'result=ok\n' > "$tmp/elsewhere"; ln -s "$tmp/elsewhere" "$backup_rec"
# Remove the link afterwards: later writes would otherwise go through it.
if [[ -L "$backup_rec" ]]; then unusable 'symlinked record'; fi
rm -f "$backup_rec"; healthy_records
write_record "$backup_rec" "result=ok"$'\n'"finished_epoch=$((now - 60))"$'\n'"not a key value line"; unusable 'malformed line'
write_record "$backup_rec" "result=ok"$'\n'"finished_epoch=0x10"; unusable 'non-decimal epoch'
write_record "$backup_rec" "result=ok"$'\n'"finished_epoch=0$((now - 60))"; unusable 'octal-looking epoch'
write_record "$backup_rec" "result=ok"; unusable 'missing epoch'
write_record "$restore_rec" "result=pass"; set_meta "$restore_rec" 0:0:640
run "$monitor" collect; expect_rc 0 'unusable restore record collect'
expect_metric mawareeth_restore_last_result_pass 0 'unusable restore record'
expect_metric mawareeth_restore_last_pass_timestamp_seconds 0 'unusable restore record'
healthy_records

# Refusals and the lock.
run "$monitor" MAWAREETH_TEXTFILE_DIR="$tmp/no-such-dir" collect
expect_rc 2 'missing textfile directory'
run "$monitor" MAWAREETH_RUNTIME_DIR="$tmp/no-such-state" collect
expect_rc 2 'missing state directory'
run "$monitor" MAWAREETH_TEXTFILE_DIR='relative/dir' collect
expect_rc 2 'relative textfile directory'
cp "$prom" "$tmp/prom-before"
if [[ -n "$real_flock" ]]; then
  exec 7>>"$state/monitor.lock"; "$real_flock" -n 7
  run "$monitor" collect
  exec 7>&-
else
  touch "$S/lock-held"; run "$monitor" collect; rm -f "$S/lock-held"
fi
expect_rc 3 'collect while the monitor lock is held'
cmp -s "$tmp/prom-before" "$prom" || fail 'a locked-out collect changed mawareeth.prom'
[[ ! -e "$state/backup.lock" && ! -e "$state/deploy.lock" ]] || fail 'monitor.sh opened the backup or deploy lock'

run "$monitor" status
expect_rc 0 'status'; need "$tmp/out" 'mawareeth_backup_last_result_ok 1'; need "$tmp/out" "== $prom"
run "$monitor" MAWAREETH_RUNTIME_DIR="$tmp/no-such-state" status
expect_rc 2 'status with a missing state directory'; lacks "$tmp/out" 'mawareeth_backup_last_result_ok'
run "$monitor" MAWAREETH_RUNTIME_DIR='relative/state' status
expect_rc 2 'status with a relative state directory'
run "$monitor" MAWAREETH_TEXTFILE_DIR='relative/dir' status
expect_rc 2 'status with a relative textfile directory'

# --- install: units, drop-ins, apt, UFW, journald --------------------------------
printf 'ID=debian\nVERSION_ID="12"\n' > "$tmp/other-os"
run "$monitor" MAWAREETH_OS_RELEASE="$tmp/other-os" install
expect_rc 2 'install on another OS'; [[ ! -s "$S/calls.log" ]] || fail 'a refused install ran commands'
touch "$S/curl-fails"; run "$monitor" install; rm -f "$S/curl-fails"
expect_rc 1 'install with an unreachable key server'; lacks "$S/calls.log" 'apt-get'
[[ ! -e "$apt/sources.list.d/tailscale.list" ]] || fail 'the Tailscale repository was added without its key'
touch "$S/ufw-inactive"; run "$monitor" install; rm -f "$S/ufw-inactive"
expect_rc 1 'install with UFW inactive'; need "$tmp/out" 'UFW is not active'
lacks "$S/calls.log" 'ufw allow'; lacks "$S/calls.log" 'apt-get'; lacks "$S/calls.log" 'curl'

run "$monitor" install
expect_rc 0 'install'
keyring="$apt/keyrings/tailscale-archive-keyring.gpg"
[[ -s "$keyring" ]] || fail 'Tailscale keyring was not installed'
need "$S/calls.log" "curl -fsSL --proto =https --tlsv1.2 -o"
need "$S/calls.log" 'https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg'
[[ "$(cat "$apt/sources.list.d/tailscale.list")" == "deb [signed-by=$keyring] https://pkgs.tailscale.com/stable/ubuntu noble main" ]] \
  || fail 'tailscale.list must pin the signed official noble repository'
need "$S/calls.log" 'apt-get update'
need "$S/calls.log" 'apt-get install -y --no-install-recommends tailscale prometheus-node-exporter'
[[ "$(grep -A1 -F 'apt-get install' "$S/calls.log" | tail -n 1)" == 'apt-get saw the exporter drop-in' ]] || fail 'the exporter drop-in must exist before the package is installed'
[[ "$(grep -n -m1 -F 'systemctl daemon-reload' "$S/calls.log" | cut -d: -f1)" -lt "$(grep -n -m1 -F 'apt-get install' "$S/calls.log" | cut -d: -f1)" ]]   || fail 'systemd must load the exporter drop-in before the package starts the exporter'
need "$S/calls.log" 'ufw status'
[[ "$(grep -c '^ufw allow' "$S/calls.log")" == 1 ]] || fail 'install must add exactly one UFW rule'
[[ "$(grep '^ufw ' "$S/calls.log" | grep -vc -e '^ufw allow' -e '^ufw status$')" == 0 ]] || fail 'install may only read the UFW status and add its rule'
need "$S/calls.log" 'ufw allow in on tailscale0 from 100.64.0.0/10 to any port 9100 proto tcp'
lacks "$S/calls.log" 'tailscale up'; lacks "$S/calls.log" 'ufw --force'; lacks "$S/calls.log" 'hcloud'

dropin="$units/prometheus-node-exporter.service.d/10-mawareeth.conf"
[[ "$(cat "$dropin")" == $'[Unit]\nAfter=tailscaled.service\nWants=tailscaled.service\nStartLimitIntervalSec=0\n[Service]\nRestart=always\nRestartSec=15\nExecStart=\nExecStart='"$sbin/mawareeth-node-exporter" ]] \
  || fail "unexpected exporter drop-in: $(cat "$dropin")"
wrapper="$sbin/mawareeth-node-exporter"
need "$wrapper" '/usr/bin/tailscale ip -4'
need "$wrapper" '--web.listen-address="$ip:9100"'
need "$wrapper" "--collector.textfile.directory=$textfile"
bash -n "$wrapper"
if (( modes_work )); then [[ "$("$real_stat" -c %a "$wrapper")" == 755 ]] || fail 'the exporter wrapper must be mode 0755'; fi
[[ "$(cat "$journald/50-mawareeth.conf")" == $'[Journal]\nSystemMaxUse=500M\nSystemKeepFree=1G\nMaxRetentionSec=30day' ]] || fail 'journald bounds differ from the spec'

timer="$units/mawareeth-monitor-collect.timer"; service="$units/mawareeth-monitor-collect.service"
for line in 'OnCalendar=*:0/5' 'Persistent=true' 'Unit=mawareeth-monitor-collect.service' 'WantedBy=timers.target'; do need "$timer" "$line"; done
for line in 'Type=oneshot' "Environment=MAWAREETH_RUNTIME_DIR=$state" "Environment=MAWAREETH_TEXTFILE_DIR=$textfile" \
  "ExecStart=/bin/bash $bundle/deploy/monitor.sh collect"; do need "$service" "$line"; done
for line in 'systemctl daemon-reload' 'systemctl restart systemd-journald' 'systemctl enable --now tailscaled.service' \
  'systemctl enable prometheus-node-exporter.service' 'systemctl restart --no-block prometheus-node-exporter.service' \
  'systemctl enable --now mawareeth-monitor-collect.timer'; do need "$S/calls.log" "$line"; done
expect_metric mawareeth_backup_last_result_ok 1 'install publishes metrics'

# --- Exporter wrapper: Tailscale IPv4 only, never a fallback ------------------------
sed "s|/usr/bin/tailscale|$stub/tailscale|; s|/usr/bin/prometheus-node-exporter|$stub/exporter|" "$wrapper" > "$tmp/wrapper"
wrapper_run() { : > "$S/calls.log"; set +e; bash "$tmp/wrapper" > "$tmp/out" 2>&1; rc=$?; set -e; }
rm -f "$S/tailscale-ip"; wrapper_run
expect_rc 1 'exporter without a Tailscale IP'; lacks "$S/calls.log" 'exporter'; need "$tmp/out" 'no Tailscale IPv4'
for address in 0.0.0.0 127.0.0.1 203.0.113.10 100.63.0.1 100.128.0.1 fd7a:115c:a1e0::1 '100.101.102.103 extra'; do
  printf '%s\n' "$address" > "$S/tailscale-ip"; wrapper_run
  expect_rc 1 "exporter with tailscale ip $address"; lacks "$S/calls.log" 'exporter'
done
printf '100.101.102.103\nfd7a:115c:a1e0::1\n' > "$S/tailscale-ip"; wrapper_run
expect_rc 0 'exporter with a Tailscale IPv4'
need "$S/calls.log" "exporter --web.listen-address=100.101.102.103:9100 --collector.textfile.directory=$textfile"

# --- p1 snippets ----------------------------------------------------------------------
need "$scrape" 'job_name: mawareeth-node'
need "$scrape" "targets: ['<tailscale-ip>:9100']"
need "$scrape" 'alias: mawareeth-prod'
need "$scrape" 'project: mawareeth'
need "$route" 'project="mawareeth"'
need "$route" "Subject: '[MAWAREETH {{ .CommonLabels.severity }}]"
need "$route" '${SMTP_TO}'
need "$route" 'alertname="MawareethHostDown"'
# Exact receiver wiring and inhibit rules.
need "$route" '    - receiver: mawareeth-email'
need "$route" '  - name: mawareeth-email'
need "$route" '        - project="mawareeth"'
need "$route" '      - alertname!="MawareethHostDown"'
need "$route" '    equal: [project]'
need "$route" '      - alertname="MawareethDiskCritical"'
need "$route" '      - alertname="MawareethDiskWarning"'
need "$route" '    equal: [project, mountpoint]'
[[ "$(grep -c '^ *- receiver: ' "$route")" == 1 && "$(grep -c '^  - name: ' "$route")" == 1 ]] || fail 'the route snippet must define exactly one route and one receiver'
for name in MawareethHostDown MawareethBackupUnhealthy MawareethRestoreUnhealthy MawareethDiskWarning MawareethDiskCritical MawareethCollectorStale; do
  need "$alerts" "alert: $name"
done
[[ "$(grep -c '^ *- alert:' "$alerts")" == 6 ]] || fail 'expected exactly six alert rules'
[[ "$(grep -c '^ *project: mawareeth$' "$alerts")" == 6 ]] || fail 'every rule needs a project: mawareeth label'
[[ "$(grep -c '^ *runbook: ' "$alerts")" == 6 ]] || fail 'every rule needs a runbook annotation'
# shellcheck disable=SC2013 # anchors are single words without spaces.
for anchor in $(grep -o 'README.md#runbook-[a-z]*' "$alerts" | sort -u | cut -d# -f2); do
  need "$root/deploy/README.md" "<a id=\"$anchor\"></a>"
done
for text in 'up{job="mawareeth-node"} == 0 or absent(up{job="mawareeth-node"})' \
  '(mawareeth_backup_last_ok_timestamp_seconds{job="mawareeth-node"} - time()) > 300' \
  '(mawareeth_restore_last_pass_timestamp_seconds{job="mawareeth-node"} - time()) > 300' \
  'node_textfile_scrape_error{job="mawareeth-node"} == 1' 'for: 2m' '> 26 * 3600' '> 35 * 86400' '> 75' '> 85' '> 20 * 60' \
  'absent(mawareeth_monitor_collect_timestamp_seconds{job="mawareeth-node"})'; do need "$alerts" "$text"; done
[[ "$(grep -c 'for: 5m' "$alerts")" == 2 ]] || fail 'both disk alerts need for: 5m'

# Under CI the external validators are mandatory.
missing_tool() {
  if [[ -n "${CI:-}" ]]; then fail "$1 is required when CI is set"; fi
  printf '%s not installed; %s skipped (static checks only)\n' "$1" "$2"
}

if command -v promtool >/dev/null 2>&1; then
  promtool check rules "$alerts" > "$tmp/out" 2>&1 || fail 'promtool check rules failed'
  labels='job="mawareeth-node",instance="100.101.102.103:9100",alias="mawareeth-prod",project="mawareeth"'
  disk='mountpoint="/",fstype="ext4",device="/dev/sda1"'; disk_yaml=', mountpoint: /, fstype: ext4, device: /dev/sda1'
  alert_labels() { printf '          - exp_labels: {severity: %s, project: mawareeth, alertname: %s, job: mawareeth-node, instance: "100.101.102.103:9100", alias: mawareeth-prod%s}\n' "$1" "$2" "${3:-}"; }
  {
    printf 'rule_files: [mawareeth-alerts.yml]\nevaluation_interval: 1m\ntests:\n'
    # Healthy: nothing fires.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'up{%s}', values: '1x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_backup_last_result_ok{%s}', values: '1x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_backup_last_ok_timestamp_seconds{%s}', values: '0x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_result_pass{%s}', values: '1x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_pass_timestamp_seconds{%s}', values: '0x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_monitor_collect_timestamp_seconds{%s}', values: '0+60x40'}\n" "$labels"
    printf "      - {series: 'node_filesystem_size_bytes{%s,%s}', values: '100x40'}\n" "$labels" "$disk"
    printf "      - {series: 'node_filesystem_avail_bytes{%s,%s}', values: '50x40'}\n" "$labels" "$disk"
    printf '    alert_rule_test:\n'
    for name in MawareethHostDown MawareethBackupUnhealthy MawareethRestoreUnhealthy MawareethDiskWarning MawareethDiskCritical MawareethCollectorStale; do
      printf '      - {eval_time: 30m, alertname: %s, exp_alerts: []}\n' "$name"
    done
    # Backup and restore failures fire at once; old successes fire past 26h/35d.
    printf '  - interval: 1h\n    input_series:\n'
    printf "      - {series: 'mawareeth_backup_last_result_ok{%s}', values: '1x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_backup_last_ok_timestamp_seconds{%s}', values: '0x40'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 25h, alertname: MawareethBackupUnhealthy, exp_alerts: []}\n'
    printf '      - eval_time: 27h\n        alertname: MawareethBackupUnhealthy\n        exp_alerts:\n'; alert_labels critical MawareethBackupUnhealthy
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'mawareeth_backup_last_result_ok{%s}', values: '0x5'}\n" "$labels"
    printf "      - {series: 'mawareeth_backup_last_ok_timestamp_seconds{%s}', values: '0x5'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_result_pass{%s}', values: '0x5'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_pass_timestamp_seconds{%s}', values: '0x5'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - eval_time: 1m\n        alertname: MawareethBackupUnhealthy\n        exp_alerts:\n'; alert_labels critical MawareethBackupUnhealthy
    printf '      - eval_time: 1m\n        alertname: MawareethRestoreUnhealthy\n        exp_alerts:\n'; alert_labels critical MawareethRestoreUnhealthy
    printf '  - interval: 1d\n    input_series:\n'
    printf "      - {series: 'mawareeth_restore_last_result_pass{%s}', values: '1x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_pass_timestamp_seconds{%s}', values: '0x40'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 34d, alertname: MawareethRestoreUnhealthy, exp_alerts: []}\n'
    printf '      - eval_time: 36d\n        alertname: MawareethRestoreUnhealthy\n        exp_alerts:\n'; alert_labels critical MawareethRestoreUnhealthy
    # Disk: 80% used warns after 5m; 90% used is critical (and also warns).
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_filesystem_size_bytes{%s,%s}', values: '100x20'}\n" "$labels" "$disk"
    printf "      - {series: 'node_filesystem_avail_bytes{%s,%s}', values: '20x10 10x10'}\n" "$labels" "$disk"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 4m, alertname: MawareethDiskWarning, exp_alerts: []}\n'
    printf '      - eval_time: 7m\n        alertname: MawareethDiskWarning\n        exp_alerts:\n'; alert_labels warning MawareethDiskWarning "$disk_yaml"
    printf '      - {eval_time: 9m, alertname: MawareethDiskCritical, exp_alerts: []}\n'
    printf '      - eval_time: 17m\n        alertname: MawareethDiskCritical\n        exp_alerts:\n'; alert_labels critical MawareethDiskCritical "$disk_yaml"
    # Host down for 2m; a collector that stopped 20m ago or never published.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'up{%s}', values: '0x30'}\n" "$labels"
    printf "      - {series: 'mawareeth_monitor_collect_timestamp_seconds{%s}', values: '0x30'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 1m, alertname: MawareethHostDown, exp_alerts: []}\n'
    printf '      - eval_time: 3m\n        alertname: MawareethHostDown\n        exp_alerts:\n'; alert_labels critical MawareethHostDown
    printf '      - {eval_time: 19m, alertname: MawareethCollectorStale, exp_alerts: []}\n'
    printf '      - eval_time: 21m\n        alertname: MawareethCollectorStale\n        exp_alerts:\n'; alert_labels warning MawareethCollectorStale
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'up{%s}', values: '1x5'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - eval_time: 1m\n        alertname: MawareethCollectorStale\n        exp_alerts:\n          - exp_labels: {severity: warning, project: mawareeth, alertname: MawareethCollectorStale, job: mawareeth-node}\n'
    # The scrape job is missing on p1: up is absent, HostDown still fires.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'mawareeth_monitor_collect_timestamp_seconds{%s}', values: '0+60x10'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 1m, alertname: MawareethHostDown, exp_alerts: []}\n'
    printf '      - eval_time: 3m\n        alertname: MawareethHostDown\n        exp_alerts:\n          - exp_labels: {severity: critical, project: mawareeth, alertname: MawareethHostDown, job: mawareeth-node}\n'
    # Future-dated records (clock skew) fire beyond 300s, not within it.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'mawareeth_backup_last_result_ok{%s}', values: '1x5'}\n" "$labels"
    printf "      - {series: 'mawareeth_backup_last_ok_timestamp_seconds{%s}', values: '1000x5'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_result_pass{%s}', values: '1x5'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_pass_timestamp_seconds{%s}', values: '1000x5'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - eval_time: 1m\n        alertname: MawareethBackupUnhealthy\n        exp_alerts:\n'; alert_labels critical MawareethBackupUnhealthy
    printf '      - eval_time: 1m\n        alertname: MawareethRestoreUnhealthy\n        exp_alerts:\n'; alert_labels critical MawareethRestoreUnhealthy
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'mawareeth_backup_last_result_ok{%s}', values: '1x5'}\n" "$labels"
    printf "      - {series: 'mawareeth_backup_last_ok_timestamp_seconds{%s}', values: '300x5'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_result_pass{%s}', values: '1x5'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_pass_timestamp_seconds{%s}', values: '300x5'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 1m, alertname: MawareethBackupUnhealthy, exp_alerts: []}\n'
    printf '      - {eval_time: 1m, alertname: MawareethRestoreUnhealthy, exp_alerts: []}\n'
    # The textfile collector cannot parse mawareeth.prom.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'up{%s}', values: '1x5'}\n" "$labels"
    printf "      - {series: 'mawareeth_monitor_collect_timestamp_seconds{%s}', values: '0+60x5'}\n" "$labels"
    printf "      - {series: 'node_textfile_scrape_error{%s}', values: '0 1x4'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 0m, alertname: MawareethCollectorStale, exp_alerts: []}\n'
    printf '      - eval_time: 2m\n        alertname: MawareethCollectorStale\n        exp_alerts:\n'; alert_labels warning MawareethCollectorStale
  } > "$tmp/alerts.test.yml"
  # Rule paths resolve relative to the test file. Annotations (checked
  # statically above) are dropped so expectations compare labels only.
  sed '/^        annotations:$/,/^          runbook: /d' "$alerts" > "$tmp/mawareeth-alerts.yml"
  ! grep -v '^#' "$tmp/mawareeth-alerts.yml" | grep -Eq 'annotations|summary|runbook' || fail 'annotation stripping for promtool failed'
  promtool test rules "$tmp/alerts.test.yml" > "$tmp/out" 2>&1 || fail 'promtool rule unit tests failed'
  printf 'promtool rule checks passed\n'
else
  missing_tool promtool 'rule unit tests'
fi

if command -v amtool >/dev/null 2>&1; then
  # A minimal valid Alertmanager config around the snippet, as merged on p1.
  {
    printf 'global:\n  smtp_smarthost: smtp.example.invalid:587\n  smtp_from: alerts@example.invalid\n'
    printf 'route:\n  receiver: scdf-default\n'
    sed -n '/^route:$/,/^receivers:$/p' "$route" | sed '1d;$d'
    printf 'receivers:\n  - name: scdf-default\n    email_configs:\n      - to: ops@example.invalid\n'
    sed -n '/^receivers:$/,/^inhibit_rules:$/p' "$route" | sed '1d;$d'
    sed -n '/^inhibit_rules:$/,$p' "$route"
  } | sed 's/\${SMTP_TO}/ops@example.invalid/' > "$tmp/alertmanager.yml"
  ! grep -Fq '${' "$tmp/alertmanager.yml" || fail 'a ${...} placeholder survived into the Alertmanager config'
  amtool check-config "$tmp/alertmanager.yml" > "$tmp/out" 2>&1 || fail 'amtool check-config rejected the route snippet'
  amtool config routes test --config.file="$tmp/alertmanager.yml" --verify.receivers=mawareeth-email project=mawareeth > "$tmp/out" 2>&1 \
    || fail 'project=mawareeth does not route to mawareeth-email'
  amtool config routes test --config.file="$tmp/alertmanager.yml" --verify.receivers=scdf-default project=scdf > "$tmp/out" 2>&1 \
    || fail 'the Mawareeth route captured another project'
  printf 'amtool route checks passed\n'
else
  missing_tool amtool 'Alertmanager route checks'
fi

printf 'deploy/monitor.sh tests passed\n'
