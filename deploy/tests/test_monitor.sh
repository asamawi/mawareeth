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
# No real Better Stack heartbeat URL (it works as a bearer secret) anywhere in
# the repository; p1 substitutes ${MAWAREETH_HEARTBEAT_URL} instead.
# grep exits 1 for no match; 0 (a match) or 2 (an error) both fail.
set +e
grep -rIilE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir='*venv' \
  '(betterstack|betteruptime)\.com/[^[:space:]]*heartbeat/[A-Za-z0-9]' "$root"
scan_rc=$?
set -e
(( scan_rc != 0 )) || fail 'a Better Stack heartbeat URL is committed in the files listed above'
(( scan_rc == 1 )) || fail "the heartbeat URL scan failed (grep exit $scan_rc)"

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

# Every stubbed command appends its argv to calls.log. systemctl also records
# whether the exporter wrapper already carried --collector.systemd when the
# exporter was restarted (the upgrade path rewrites it first).
cat > "$stub/systemctl" <<EOF
#!/usr/bin/env bash
printf '%s\n' "systemctl \$*" >> '$S/calls.log'
if [[ "\$*" == 'restart --no-block prometheus-node-exporter.service' ]] && grep -Fq -- '--collector.systemd' '$sbin/mawareeth-node-exporter' 2>/dev/null; then
  printf 'systemctl restart saw the systemd collector in the wrapper\n' >> '$S/calls.log'
fi
EOF
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
sync_works=0; if "$real_sync" -- "$tmp/sync-probe" 2>/dev/null; then sync_works=1; fi
# sync fails for the drill history while "$S/sync-fail-history" exists; it is
# a no-op where the real one cannot sync single files.
cat > "$stub/sync" <<EOF
#!/usr/bin/env bash
if [[ -e '$S/sync-fail-history' && "\${*: -1}" == */drill-history ]]; then exit 1; fi
if (( $sync_works )); then exec '$real_sync' "\$@"; fi
EOF
# mktemp fails in the textfile directory while "$S/mktemp-fail-textfile" exists.
real_mktemp="$(command -v mktemp)"
cat > "$stub/mktemp" <<EOF
#!/usr/bin/env bash
if [[ -e '$S/mktemp-fail-textfile' && "\${*: -1}" == '$textfile/'* ]]; then exit 1; fi
exec '$real_mktemp' "\$@"
EOF
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
hex64() { printf "$1%.0s" {1..64}; }
host_state_line="host_state_snapshot=$(hex64 a)"; globals_line="globals_snapshot=$(hex64 b)"
healthy_records() {
  write_record "$backup_rec" "result=ok"$'\n'"run=20261014T023000Z"$'\n'"finished_epoch=$((now - 3600))"$'\n'"$host_state_line"$'\n'"$globals_line"
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
expect_metric mawareeth_backup_last_archives_complete 1 healthy
expect_metric mawareeth_drill_active_code 0 'absent drill record'
expect_metric mawareeth_drill_last_pass_timestamp_seconds 0 'absent drill record'
collected="$(metric mawareeth_monitor_collect_timestamp_seconds)"
# shellcheck disable=SC2015 # fail exits, so it runs only when the check fails.
[[ "$collected" =~ ^[1-9][0-9]+$ ]] && (( collected >= now && collected <= now + 120 )) || fail "collect timestamp $collected is not the current time"

# Prom text format: HELP, TYPE gauge, then one sample, for exactly eight metrics.
[[ "$(grep -c '^# TYPE .* gauge$' "$prom")" == 8 ]] || fail 'expected eight gauges'
[[ "$(grep -vc '^#' "$prom")" == 8 ]] || fail 'expected eight samples'
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
expect_metric mawareeth_backup_last_archives_complete 0 'failed backup'
expect_metric mawareeth_restore_last_result_pass 1 'failed backup leaves restore healthy'
write_record "$backup_rec" "result=ok"$'\n'"finished_epoch=$((now - 27 * 3600))"
run "$monitor" collect; expect_rc 0 'old backup collect'
expect_metric mawareeth_backup_last_result_ok 1 'old backup'
expect_metric mawareeth_backup_last_ok_timestamp_seconds "$((now - 27 * 3600))" 'old backup'

# Archives complete: only an ok record naming both a host-state and a globals
# snapshot (64-hex Restic IDs) publishes 1.
ok_rec="result=ok"$'\n'"finished_epoch=$((now - 60))"
write_record "$backup_rec" "$ok_rec"$'\n'"$host_state_line"$'\n'"$globals_line"
run "$monitor" collect; expect_rc 0 'complete backup collect'
expect_metric mawareeth_backup_last_archives_complete 1 'ok backup with every archive'
write_record "$backup_rec" "$ok_rec"$'\n'"$globals_line"
run "$monitor" collect; expect_rc 0 'backup without host state collect'
expect_metric mawareeth_backup_last_archives_complete 0 'ok backup missing host state'
expect_metric mawareeth_backup_last_result_ok 1 'ok backup missing host state stays ok'
write_record "$backup_rec" "$ok_rec"$'\n'"$host_state_line"
run "$monitor" collect; expect_rc 0 'backup without globals collect'
expect_metric mawareeth_backup_last_archives_complete 0 'ok backup missing globals'
write_record "$backup_rec" "$ok_rec"$'\n'"host_state_snapshot="$'\n'"globals_snapshot="
run "$monitor" collect; expect_rc 0 'backup with empty archive IDs collect'
expect_metric mawareeth_backup_last_archives_complete 0 'ok backup with empty archive IDs'
write_record "$backup_rec" "$ok_rec"$'\n'"host_state_snapshot=$(hex64 A)"$'\n'"$globals_line"
run "$monitor" collect; expect_rc 0 'backup with a malformed archive ID collect'
expect_metric mawareeth_backup_last_archives_complete 0 'ok backup with a malformed archive ID'
write_record "$backup_rec" "result=failed:host-state"$'\n'"finished_epoch=$((now - 60))"$'\n'"$host_state_line"$'\n'"$globals_line"
run "$monitor" collect; expect_rc 0 'failed backup with archive IDs collect'
expect_metric mawareeth_backup_last_archives_complete 0 'failed backup with archive IDs'

# archives_metric reads the backup record itself, so the record read before it
# cannot leak: a complete backup beside evidence that lacks globals_snapshot
# is 1, and an incomplete backup beside a record that would pass is 0, even
# when the other record was read last.
write_record "$backup_rec" "$ok_rec"$'\n'"$host_state_line"$'\n'"$globals_line"
write_record "$restore_rec" "result=pass"$'\n'"verified_epoch=$((now - 86400))"$'\n'"$host_state_line"
run "$monitor" collect; expect_rc 0 'complete backup beside evidence without globals collect'
expect_metric mawareeth_backup_last_archives_complete 1 'complete backup beside evidence without globals'
# archives_after_other prints archives_complete computed right after reading
# the restore record (monitor.sh sourced; its collect runs first).
archives_after_other() {
  env "${base_env[@]}" bash -c 'source "$1" collect; read_record "$evidence_file"; metric_ok=0; archives_metric; printf "%s\n" "$archives_complete"' _ "$monitor" 2>"$tmp/out"
}
[[ "$(archives_after_other)" == 1 ]] || fail 'archives_metric depends on the record read before it (complete backup)'
write_record "$backup_rec" "$ok_rec"$'\n'"$host_state_line"
write_record "$restore_rec" "result=ok"$'\n'"verified_epoch=$((now - 86400))"$'\n'"$host_state_line"$'\n'"$globals_line"
[[ "$(archives_after_other)" == 0 ]] || fail 'archives_metric depends on the record read before it (incomplete backup)'
# An ok record with both IDs is still unusable without a plain decimal
# finished_epoch.
for epoch_line in "finished_epoch=0x10" "finished_epoch=0$((now - 60))" ''; do
  write_record "$backup_rec" "result=ok"$'\n'"$host_state_line"$'\n'"$globals_line${epoch_line:+$'\n'$epoch_line}"
  run "$monitor" collect; expect_rc 0 "ok backup with both IDs and finished_epoch '${epoch_line#finished_epoch=}' collect"
  expect_metric mawareeth_backup_last_archives_complete 0 "ok backup with both IDs and a bad or missing finished_epoch ('$epoch_line')"
done

# Records written by the previous backup.sh (no globals_role_passwords, no
# restore_seconds) publish exactly as before; the new fields change nothing.
write_record "$backup_rec" "$ok_rec"$'\n'"run=20261014T023000Z"$'\n'"dump_snapshot=$(hex64 c)"$'\n'"manifest_snapshot=$(hex64 d)"$'\n'"$host_state_line"$'\n'"$globals_line"$'\n'"pg_major=17"
write_record "$restore_rec" "result=pass"$'\n'"verified_epoch=$((now - 86400))"$'\n'"duration_seconds=900"$'\n'"content_checksums=1"
run "$monitor" collect; expect_rc 0 'previous-script records collect'
expect_metric mawareeth_backup_last_result_ok 1 'previous-script backup record'
expect_metric mawareeth_backup_last_ok_timestamp_seconds "$((now - 60))" 'previous-script backup record'
expect_metric mawareeth_backup_last_archives_complete 1 'previous-script backup record with both IDs'
expect_metric mawareeth_restore_last_result_pass 1 'previous-script evidence record'
expect_metric mawareeth_restore_last_pass_timestamp_seconds "$((now - 86400))" 'previous-script evidence record'
write_record "$backup_rec" "$ok_rec"$'\n'"run=20261014T023000Z"$'\n'"$host_state_line"$'\n'"pg_major=17"
run "$monitor" collect; expect_rc 0 'previous-script record without globals collect'
expect_metric mawareeth_backup_last_result_ok 1 'previous-script backup record without globals'
expect_metric mawareeth_backup_last_archives_complete 0 'previous-script backup record without globals'

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
  expect_metric mawareeth_backup_last_archives_complete 0 "$label"
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

# --- Alert-path drill: every drill row of the matrix -------------------------------
drill_rec="$state/monitor/drill"; drill_hist="$state/monitor/drill-history"
# drill ARGS... runs monitor.sh drill with the base environment.
drill() {
  : > "$S/calls.log"
  set +e
  env "${base_env[@]}" bash "$monitor" drill "$@" > "$tmp/out" 2>&1
  rc=$?
  set -e
}
# drill_locked ARGS... runs the drill while another process holds the monitor lock.
drill_locked() {
  if [[ -n "$real_flock" ]]; then
    exec 7>>"$state/monitor.lock"; "$real_flock" -n 7
    drill "$@"
    exec 7>&-
  else
    touch "$S/lock-held"; drill "$@"; rm -f "$S/lock-held"
  fi
}
field() { sed -n "s/^$1=//p" "$drill_rec"; }
unchanged() {
  cmp -s "$tmp/drill-before" "$drill_rec" || fail "$1 changed the drill record"
  cmp -s "$tmp/hist-before" "$drill_hist" || fail "$1 changed the drill history"
  cmp -s "$tmp/prom-before" "$prom" || fail "$1 changed mawareeth.prom"
}
snapshot() { cp "$drill_rec" "$tmp/drill-before"; cp "$drill_hist" "$tmp/hist-before"; cp "$prom" "$tmp/prom-before"; }

for args in '' bogus 'start extra' 'abort extra' confirm 'confirm 123456 --better-stack-received extra'; do
  # shellcheck disable=SC2086 # word splitting builds the argument list.
  drill $args; expect_rc 2 "drill '$args'"; need "$tmp/out" 'usage: monitor.sh drill'
done
[[ ! -e "$state/monitor" ]] || fail 'a refused drill created the drill directory'
run "$monitor" status; expect_rc 0 'status with no drill record'
need "$tmp/out" "== $drill_rec"; need "$tmp/out" '(absent: no drill has run)'

# Confirm and abort on a fresh state directory refuse without creating anything.
cp "$prom" "$tmp/prom-before"
drill confirm 123456 --better-stack-received; expect_rc 2 'drill confirm on a fresh host'; need "$tmp/out" 'no drill is active'
drill abort; expect_rc 2 'drill abort on a fresh host'; need "$tmp/out" 'no drill is active'
[[ ! -e "$state/monitor" ]] || fail 'a refused confirm or abort created the drill directory'
cmp -s "$tmp/prom-before" "$prom" || fail 'a refused confirm or abort changed mawareeth.prom'

# A drill directory that is a symlink or has the wrong mode is refused.
mkdir "$tmp/elsewhere-dir"; ln -s "$tmp/elsewhere-dir" "$state/monitor"
if [[ -L "$state/monitor" ]]; then
  drill start; expect_rc 2 'drill start with a symlinked drill directory'; need "$tmp/out" 'must be a directory'
  [[ -z "$(ls -A "$tmp/elsewhere-dir")" ]] || fail 'drill start wrote through a symlinked drill directory'
fi
rm -rf "$state/monitor"
mkdir "$state/monitor"; set_meta "$state/monitor" 0:0:755
drill start; expect_rc 2 'drill start with a mode-0755 drill directory'; need "$tmp/out" 'mode 0700'
[[ -z "$(ls -A "$state/monitor")" ]] || fail 'drill start wrote into a wrong-mode drill directory'
set_meta "$state/monitor" 0:0:700; rmdir "$state/monitor"

# Lock held before any drill: nothing is created.
cp "$prom" "$tmp/prom-before"
drill_locked start; expect_rc 3 'drill start while the monitor lock is held'
[[ ! -e "$drill_rec" ]] || fail 'a locked-out drill start wrote a record'
cmp -s "$tmp/prom-before" "$prom" || fail 'a locked-out drill start changed mawareeth.prom'

# Start from an absent record.
drill start; expect_rc 0 'drill start'
code="$(field code)"
[[ "$code" =~ ^[1-9][0-9]{5}$ ]] || fail "drill code $code is not six digits"
need "$tmp/out" "code $code"
[[ "$(field state)" == active ]] || fail 'drill start must record state=active'
started="$(field started_epoch)"
(( started >= now && started <= now + 600 )) || fail "drill started_epoch $started is not the current time"
expect_metric mawareeth_drill_active_code "$code" 'drill start'
expect_metric mawareeth_drill_last_pass_timestamp_seconds 0 'drill start before any pass'
expect_metric mawareeth_backup_last_result_ok 1 'drill start republishes the other metrics'
[[ "$(wc -l < "$drill_hist")" == 1 ]] || fail 'drill start must append one history line'; need "$drill_hist" "event=start code=$code"
grep -Eq ' by=[A-Za-z0-9._-]+$' "$drill_hist" || fail 'drill history lines must name the operator'
[[ -z "$(find "$state/monitor" -name '.tmp.*' -print -quit)" ]] || fail 'drill start left a temporary file'
if (( modes_work )); then
  for path in "$drill_rec" "$drill_hist"; do [[ "$("$real_stat" -c %a "$path")" == 600 ]] || fail "$path must be mode 0600"; done
  [[ "$("$real_stat" -c %a "$state/monitor")" == 700 ]] || fail 'the drill directory must be mode 0700'
fi
need "$prom" '# TYPE mawareeth_drill_active_code gauge'
[[ "$(grep -c '^# TYPE .* gauge$' "$prom")" == 8 ]] || fail 'drill publishing must keep eight gauges'

# Refusals while active leave everything unchanged.
snapshot
drill start; expect_rc 2 'drill start while active'; need "$tmp/out" 'already active'; unchanged 'a second drill start'
wrong=100000; [[ "$code" != "$wrong" ]] || wrong=100001
drill confirm "$wrong" --better-stack-received; expect_rc 2 'drill confirm with a wrong code'; unchanged 'a wrong-code confirm'
drill confirm "$code"; expect_rc 2 'drill confirm without --better-stack-received'; need "$tmp/out" 'Better Stack'; unchanged 'a confirm without the flag'
drill confirm "$code" --better-stack; expect_rc 2 'drill confirm with a misspelt flag'; unchanged 'a confirm with a misspelt flag'
drill confirm 0"$code" --better-stack-received; expect_rc 2 'drill confirm with a malformed code'; unchanged 'a malformed-code confirm'
drill_locked confirm "$code" --better-stack-received; expect_rc 3 'drill confirm while the monitor lock is held'; unchanged 'a locked-out confirm'
[[ "$(field state)" == active ]] || fail 'the drill must still be active after refused confirms'
[[ ! -e "$state/backup.lock" && ! -e "$state/deploy.lock" ]] || fail 'monitor.sh drill opened the backup or deploy lock'

# A history path that is a symlink, a directory, or the wrong mode is refused
# before the record is touched.
mv "$drill_hist" "$tmp/hist-saved"
ln -s "$tmp/elsewhere" "$drill_hist"
if [[ -L "$drill_hist" ]]; then
  drill confirm "$code" --better-stack-received; expect_rc 2 'drill confirm with a symlinked history'
  cmp -s "$tmp/drill-before" "$drill_rec" || fail 'a refused confirm (symlinked history) changed the drill record'
fi
rm -f "$drill_hist"; mkdir "$drill_hist"
drill abort; expect_rc 2 'drill abort with a directory as history'
cmp -s "$tmp/drill-before" "$drill_rec" || fail 'a refused abort (history directory) changed the drill record'
rmdir "$drill_hist"; mv "$tmp/hist-saved" "$drill_hist"; set_meta "$drill_hist" 0:0:644
drill confirm "$code" --better-stack-received; expect_rc 2 'drill confirm with a world-readable history'
set_meta "$drill_hist" 0:0:600; chmod 600 "$drill_hist"
unchanged 'refusals on a bad history path'

# A failed history append restores the record and trims the history.
touch "$S/sync-fail-history"
drill confirm "$code" --better-stack-received; rm -f "$S/sync-fail-history"
expect_rc 1 'drill confirm whose history append fails'; need "$tmp/out" 'the drill record was restored'
unchanged 'a confirm whose history append failed'

# Confirm passes.
drill confirm "$code" --better-stack-received; expect_rc 0 'drill confirm'
[[ "$(field state)" == idle && -z "$(field code)" && "$(field last_result)" == pass ]] || fail 'drill confirm must leave state=idle, an empty code, and last_result=pass'
passed="$(field last_pass_epoch)"
(( passed >= now && passed <= now + 600 )) || fail "last_pass_epoch $passed is not the current time"
[[ "$(field last_pass_at)" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || fail 'last_pass_at must be an ISO UTC time'
[[ "$(field started_epoch)" == "$started" ]] || fail 'drill confirm must keep started_epoch'
expect_metric mawareeth_drill_active_code 0 'drill confirm'
expect_metric mawareeth_drill_last_pass_timestamp_seconds "$passed" 'drill confirm'
[[ "$(wc -l < "$drill_hist")" == 2 ]] || fail 'drill confirm must append one history line'; need "$drill_hist" "event=pass code=$code"
run "$monitor" status; expect_rc 0 'status after a pass'
grep -Eq '^last_pass_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "$tmp/out" || fail 'status must show last_pass_at after a pass'

# Confirm or abort while idle are refused.
snapshot
drill confirm "$code" --better-stack-received; expect_rc 2 'drill confirm while idle'; unchanged 'a confirm while idle'
drill abort; expect_rc 2 'drill abort while idle'; unchanged 'an abort while idle'

# Abort keeps the previous pass.
drill start; expect_rc 0 'second drill start'
code2="$(field code)"; expect_metric mawareeth_drill_active_code "$code2" 'second drill start'
expect_metric mawareeth_drill_last_pass_timestamp_seconds "$passed" 'second drill start keeps the last pass'
drill abort; expect_rc 0 'drill abort'
[[ "$(field state)" == idle && -z "$(field code)" && "$(field last_result)" == aborted && "$(field last_pass_epoch)" == "$passed" ]] \
  || fail 'drill abort must leave state=idle, last_result=aborted, and the previous pass'
expect_metric mawareeth_drill_active_code 0 'drill abort'
expect_metric mawareeth_drill_last_pass_timestamp_seconds "$passed" 'drill abort'
[[ "$(wc -l < "$drill_hist")" == 4 ]] || fail 'drill abort must append one history line'; need "$drill_hist" "event=aborted code=$code2"
if (( modes_work )); then
  for path in "$drill_rec" "$drill_hist"; do [[ "$("$real_stat" -c %a "$path")" == 600 ]] || fail "$path must stay mode 0600"; done
fi

# status shows the drill record.
run "$monitor" status; expect_rc 0 'status with a drill record'
need "$tmp/out" "== $drill_rec"; need "$tmp/out" 'state=idle'; need "$tmp/out" 'last_result=aborted'

# Unusable drill records publish 0 for both drill metrics; drill commands refuse them.
drill_unusable() {
  local label="$1"
  run "$monitor" collect; expect_rc 0 "$label collect"
  expect_metric mawareeth_drill_active_code 0 "$label"
  expect_metric mawareeth_drill_last_pass_timestamp_seconds 0 "$label"
}
active_rec="state=active"$'\n'"code=123456"$'\n'"started_epoch=$now"$'\n'"last_result=pass"$'\n'"last_pass_epoch=$((now - 60))"$'\n'"last_pass_at=x"
write_record "$drill_rec" "$active_rec"
run "$monitor" collect; expect_rc 0 'active drill collect'
expect_metric mawareeth_drill_active_code 123456 'active drill record'
expect_metric mawareeth_drill_last_pass_timestamp_seconds "$((now - 60))" 'active drill record'
set_meta "$drill_rec" 0:0:644; drill_unusable 'world-readable drill record'
run "$monitor" status; expect_rc 0 'status with a world-readable drill record'
need "$tmp/out" '(unusable'; lacks "$tmp/out" 'state='
snapshot; drill abort; expect_rc 2 'drill abort with an unusable record'; unchanged 'a drill abort on an unusable record'
drill start; expect_rc 2 'drill start with an unusable record'; unchanged 'a drill start on an unusable record'
set_meta "$drill_rec" 1000:1000:600; drill_unusable 'mis-owned drill record'
write_record "$drill_rec" "$active_rec"$'\n'"not a key value line"; drill_unusable 'malformed drill record'
rm -f "$drill_rec"; ln -s "$tmp/elsewhere" "$drill_rec"
if [[ -L "$drill_rec" ]]; then
  drill_unusable 'symlinked drill record'
  run "$monitor" status; expect_rc 0 'status with a symlinked drill record'
  need "$tmp/out" '(unusable'; lacks "$tmp/out" 'state='
fi
rm -f "$drill_rec"
write_record "$drill_rec" "state=active"$'\n'"code=012345"$'\n'"last_pass_epoch=0x10"; drill_unusable 'bad code and epoch'
write_record "$drill_rec" "state=active"$'\n'"code=1234567"$'\n'"last_pass_epoch=0$now"; drill_unusable 'long code and octal-looking epoch'
# Commands refuse records the collector would only partly use.
for bad in "state=active"$'\n'"code=012345" "state=active"$'\n'"code=123456"$'\n'"started_epoch=0x10" \
  "state=active"$'\n'"code=123456"$'\n'"last_pass_epoch=0$now" "state=active"$'\n'"code=123456"$'\n'"last_result=maybe" \
  "state=idle"$'\n'"code=123456"; do
  write_record "$drill_rec" "$bad"; snapshot
  drill abort; expect_rc 2 "drill abort on an inconsistent record"; need "$tmp/out" 'unusable'; unchanged 'an abort on an inconsistent record'
  drill confirm 123456 --better-stack-received; expect_rc 2 "drill confirm on an inconsistent record"; unchanged 'a confirm on an inconsistent record'
done
write_record "$drill_rec" "state=idle"$'\n'"code=123456"$'\n'"last_pass_epoch=$((now - 60))"
run "$monitor" collect; expect_rc 0 'idle drill with a stale code collect'
expect_metric mawareeth_drill_active_code 0 'an idle record never publishes its code'
expect_metric mawareeth_drill_last_pass_timestamp_seconds "$((now - 60))" 'idle drill record'
write_record "$drill_rec" "state=paused"$'\n'"code=123456"
snapshot
drill start; expect_rc 2 'drill start with an unknown state'; unchanged 'a drill start on an unknown state'
drill confirm 123456 --better-stack-received; expect_rc 2 'drill confirm with an unknown state'; unchanged 'a drill confirm on an unknown state'
drill abort; expect_rc 2 'drill abort with an unknown state'; unchanged 'a drill abort on an unknown state'
rm -f "$drill_rec"

# A failed publish after the record changed exits 1 and says the state changed.
touch "$S/mktemp-fail-textfile"
drill start; rm -f "$S/mktemp-fail-textfile"
expect_rc 1 'drill start whose publish fails'; need "$tmp/out" 'the drill state WAS changed'; lacks "$tmp/out" 'nothing was changed'
[[ "$(field state)" == active ]] || fail 'a drill start whose publish failed must still be recorded'
need "$drill_hist" "event=start code=$(field code)"
drill abort; expect_rc 0 'abort after a failed publish'
rm -f "$drill_rec"

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

# Upgrade path: an old wrapper without --collector.systemd is rewritten before
# the exporter is restarted.
mkdir -p "$sbin"
# shellcheck disable=SC2016 # $ip is literal wrapper text.
printf '#!/usr/bin/env bash\nexec /usr/bin/prometheus-node-exporter --web.listen-address="$ip:9100" --collector.textfile.directory=%s\n' "$textfile" > "$sbin/mawareeth-node-exporter"
run "$monitor" install
expect_rc 0 'install'
need "$sbin/mawareeth-node-exporter" '--collector.systemd'
[[ "$(grep -A1 -Fx 'systemctl restart --no-block prometheus-node-exporter.service' "$S/calls.log" | tail -n 1)" == 'systemctl restart saw the systemd collector in the wrapper' ]] \
  || fail 'install must rewrite an old exporter wrapper with --collector.systemd before restarting the exporter'
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
need "$wrapper" "--collector.textfile.directory=$textfile --collector.systemd"
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
need "$S/calls.log" "exporter --web.listen-address=100.101.102.103:9100 --collector.textfile.directory=$textfile --collector.systemd"

# --- p1 snippets ----------------------------------------------------------------------
need "$scrape" 'job_name: mawareeth-node'
need "$scrape" "targets: ['<tailscale-ip>:9100']"
need "$scrape" 'alias: mawareeth-prod'
need "$scrape" 'project: mawareeth'
need "$route" 'project="mawareeth"'
need "$route" "Subject: '[MAWAREETH {{ .CommonLabels.severity }}]"
need "$route" '${SMTP_TO}'
need "$route" "      - url: '\${MAWAREETH_HEARTBEAT_URL}'"
need "$route" '        send_resolved: false'
need "$route" 'alertname="MawareethHostDown"'
need "$route" 'send_resolved: true'
# Exact receiver wiring and inhibit rules.
need "$route" '    - receiver: mawareeth-email'
need "$route" '  - name: mawareeth-email'
need "$route" '        - project="mawareeth"'
need "$route" '      - alertname!="MawareethHostDown"'
need "$route" '    - receiver: mawareeth-heartbeat'
need "$route" '  - name: mawareeth-heartbeat'
need "$route" '        - alertname="MawareethWatchdog"'
for line in '      group_wait: 0s' '      group_interval: 1m' '      repeat_interval: 1m'; do need "$route" "$line"; done
# The Watchdog route is the first child, ahead of the project route; the
# HostDown inhibit never targets it; its receiver is a webhook, never email.
[[ "$(grep -m1 '^ *- receiver: ' "$route")" == '    - receiver: mawareeth-heartbeat' ]] || fail 'the Watchdog route must be the first child route'
hostdown_inhibit="$(sed -n '/^  - source_matchers:$/,/^    equal: /p' "$route" | sed -n '/alertname="MawareethHostDown"/,/^    equal: /p')"
grep -Fxq '      - alertname!="MawareethWatchdog"' <<< "$hostdown_inhibit" || fail 'the HostDown inhibit must exclude MawareethWatchdog'
heartbeat_receiver="$(sed -n '/^  - name: mawareeth-heartbeat$/,/^  - name: /p' "$route")"
grep -Fq 'webhook_configs:' <<< "$heartbeat_receiver" || fail 'mawareeth-heartbeat must be a webhook receiver'
! grep -Fq 'email_configs' <<< "$heartbeat_receiver" || fail 'the Watchdog must never be emailed'
need "$route" '    equal: [project]'
need "$route" '      - alertname="MawareethDiskCritical"'
need "$route" '      - alertname="MawareethDiskWarning"'
need "$route" '    equal: [project, mountpoint]'
[[ "$(grep -c '^ *- receiver: ' "$route")" == 2 && "$(grep -c '^  - name: ' "$route")" == 2 ]] || fail 'the route snippet must define exactly two routes and two receivers'
[[ "$(grep -c '^  - source_matchers:$' "$route")" == 2 ]] || fail 'the route snippet must define exactly two inhibit rules'
host_rules='MawareethInodesLow MawareethFilesystemReadOnly MawareethMemoryPressure MawareethOOMKill MawareethSystemdUnitFailed MawareethClockUnsynced'
all_rules="MawareethHostDown MawareethBackupUnhealthy MawareethBackupIncomplete MawareethRestoreUnhealthy MawareethDiskWarning MawareethDiskCritical
  MawareethCollectorStale MawareethAlertDrill MawareethDrillOverdue $host_rules MawareethWatchdog"
for name in $all_rules; do
  need "$alerts" "alert: $name"
  # Each rule's own runbook annotation names a README anchor that exists.
  anchor="$(sed -n "/alert: $name\$/,/runbook: /s|^ *runbook: 'deploy/README.md#\(runbook-[a-z]*\)'\$|\1|p" "$alerts")"
  [[ -n "$anchor" ]] || fail "$name has no runbook annotation"
  need "$root/deploy/README.md" "<a id=\"$anchor\"></a>"
done
[[ "$(grep -c '^ *- alert:' "$alerts")" == 16 ]] || fail 'expected exactly sixteen alert rules'
[[ "$(grep -c '^ *project: mawareeth$' "$alerts")" == 16 ]] || fail 'every rule needs a project: mawareeth label'
[[ "$(grep -c '^ *severity: ' "$alerts")" == 16 ]] || fail 'every rule needs a severity label'
[[ "$(grep -c '^ *runbook: ' "$alerts")" == 16 ]] || fail 'every rule needs a runbook annotation'
# shellcheck disable=SC2013 # anchors are single words without spaces.
for anchor in $(grep -o 'README.md#runbook-[a-z]*' "$alerts" | sort -u | cut -d# -f2); do
  need "$root/deploy/README.md" "<a id=\"$anchor\"></a>"
done
for text in 'up{job="mawareeth-node"} == 0 or absent(up{job="mawareeth-node"})' \
  '(mawareeth_backup_last_ok_timestamp_seconds{job="mawareeth-node"} - time()) > 300' \
  '(mawareeth_restore_last_pass_timestamp_seconds{job="mawareeth-node"} - time()) > 300' \
  'node_textfile_scrape_error{job="mawareeth-node"} == 1' 'for: 2m' '> 26 * 3600' '> 35 * 86400' '> 75' '> 85' '> 20 * 60' \
  'absent(mawareeth_monitor_collect_timestamp_seconds{job="mawareeth-node"})' \
  'expr: mawareeth_drill_active_code{job="mawareeth-node"} > 0' '{{ $value | printf "%.0f" }}' \
  '(time() - mawareeth_drill_last_pass_timestamp_seconds{job="mawareeth-node"}) > 92 * 86400' \
  'or (mawareeth_drill_last_pass_timestamp_seconds{job="mawareeth-node"} - time()) > 300' \
  'or absent(mawareeth_drill_last_pass_timestamp_seconds{job="mawareeth-node"})' \
  'severity: info' 'mawareeth_backup_last_archives_complete{job="mawareeth-node"} == 0' \
  'and mawareeth_backup_last_result_ok{job="mawareeth-node"} == 1' \
  'or (absent(mawareeth_backup_last_archives_complete{job="mawareeth-node"})' \
  'and on() mawareeth_backup_last_result_ok{job="mawareeth-node"} == 1)' \
  '100 * (1 - node_filesystem_files_free{job="mawareeth-node",fstype=~"ext4|xfs|btrfs"}' \
  '/ (node_filesystem_files{job="mawareeth-node",fstype=~"ext4|xfs|btrfs"} > 0)) > 85' \
  'expr: node_filesystem_readonly{job="mawareeth-node",fstype=~"ext4|xfs|btrfs"} == 1' \
  'node_memory_MemAvailable_bytes{job="mawareeth-node"} / node_memory_MemTotal_bytes{job="mawareeth-node"} < 0.10' \
  '/ (node_memory_SwapTotal_bytes{job="mawareeth-node"} > 0)) > 0.5' \
  'expr: increase(node_vmstat_oom_kill{job="mawareeth-node"}[10m]) > 0' \
  'node_systemd_unit_state{job="mawareeth-node",state="failed"} == 1' \
  'or absent(node_systemd_unit_state{job="mawareeth-node"})' \
  'node_timex_sync_status{job="mawareeth-node"} == 0' \
  'or abs(node_timex_offset_seconds{job="mawareeth-node"}) > 0.5' \
  'expr: vector(1)' 'severity: heartbeat'; do need "$alerts" "$text"; done
# for: delays: HostDown and read-only 2m; disk, inodes, and failed units 5m;
# memory and clock 10m. Backup, restore, collector, drill, OOM, and the
# Watchdog fire at once.
[[ "$(grep -c '^ *for: ' "$alerts")" == 8 ]] || fail 'expected exactly eight for: delays'
[[ "$(grep -c '^ *for: 2m$' "$alerts")" == 2 ]] || fail 'HostDown and the read-only alert need for: 2m'
[[ "$(grep -c '^ *for: 5m$' "$alerts")" == 4 ]] || fail 'the disk, inode, and failed-unit alerts need for: 5m'
[[ "$(grep -c '^ *for: 10m$' "$alerts")" == 2 ]] || fail 'the memory and clock alerts need for: 10m'
for name in MawareethOOMKill MawareethWatchdog; do
  ! sed -n "/alert: $name\$/,/labels:/p" "$alerts" | grep -q 'for: ' || fail "$name must fire at once"
done

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
  btrfs='mountpoint="/srv",fstype="btrfs",device="/dev/sdb1"'
  unit='name="caddy-test.service",state="failed",type="simple"'; unit_yaml=', name: caddy-test.service, state: failed, type: simple'
  watchdog_labels='          - exp_labels: {severity: heartbeat, project: mawareeth, alertname: MawareethWatchdog}'
  {
    printf 'rule_files: [mawareeth-alerts.yml]\nevaluation_interval: 1m\ntests:\n'
    # Healthy: nothing fires.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'up{%s}', values: '1x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_backup_last_result_ok{%s}', values: '1x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_backup_last_ok_timestamp_seconds{%s}', values: '0x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_backup_last_archives_complete{%s}', values: '1x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_result_pass{%s}', values: '1x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_restore_last_pass_timestamp_seconds{%s}', values: '0x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_monitor_collect_timestamp_seconds{%s}', values: '0+60x40'}\n" "$labels"
    printf "      - {series: 'node_filesystem_size_bytes{%s,%s}', values: '100x40'}\n" "$labels" "$disk"
    printf "      - {series: 'node_filesystem_avail_bytes{%s,%s}', values: '50x40'}\n" "$labels" "$disk"
    printf "      - {series: 'mawareeth_drill_active_code{%s}', values: '0x40'}\n" "$labels"
    printf "      - {series: 'mawareeth_drill_last_pass_timestamp_seconds{%s}', values: '0x40'}\n" "$labels"
    printf "      - {series: 'node_filesystem_files{%s,%s}', values: '1000x40'}\n" "$labels" "$disk"
    printf "      - {series: 'node_filesystem_files_free{%s,%s}', values: '900x40'}\n" "$labels" "$disk"
    printf "      - {series: 'node_filesystem_readonly{%s,%s}', values: '0x40'}\n" "$labels" "$disk"
    printf "      - {series: 'node_memory_MemTotal_bytes{%s}', values: '1000x40'}\n" "$labels"
    printf "      - {series: 'node_memory_MemAvailable_bytes{%s}', values: '500x40'}\n" "$labels"
    printf "      - {series: 'node_memory_SwapTotal_bytes{%s}', values: '1000x40'}\n" "$labels"
    printf "      - {series: 'node_memory_SwapFree_bytes{%s}', values: '900x40'}\n" "$labels"
    printf "      - {series: 'node_vmstat_oom_kill{%s}', values: '3x40'}\n" "$labels"
    printf "      - {series: 'node_systemd_unit_state{%s,%s}', values: '0x40'}\n" "$labels" "$unit"
    printf "      - {series: 'node_systemd_unit_state{%s,%s}', values: '1x40'}\n" "$labels" "${unit/failed/active}"
    printf "      - {series: 'node_timex_sync_status{%s}', values: '1x40'}\n" "$labels"
    printf "      - {series: 'node_timex_offset_seconds{%s}', values: '0.002x40'}\n" "$labels"
    printf '    alert_rule_test:\n'
    for name in MawareethHostDown MawareethBackupUnhealthy MawareethBackupIncomplete MawareethRestoreUnhealthy MawareethDiskWarning MawareethDiskCritical \
      MawareethCollectorStale MawareethAlertDrill MawareethDrillOverdue $host_rules; do
      printf '      - {eval_time: 30m, alertname: %s, exp_alerts: []}\n' "$name"
    done
    printf '      - eval_time: 30m\n        alertname: MawareethWatchdog\n        exp_alerts:\n%s\n' "$watchdog_labels"
    # Incomplete archives fire at once, but only while the last result is ok
    # (a failed backup is MawareethBackupUnhealthy's alert).
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'mawareeth_backup_last_archives_complete{%s}', values: '1x2 0x10'}\n" "$labels"
    printf "      - {series: 'mawareeth_backup_last_result_ok{%s}', values: '1x6 0x6'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 1m, alertname: MawareethBackupIncomplete, exp_alerts: []}\n'
    printf '      - eval_time: 4m\n        alertname: MawareethBackupIncomplete\n        exp_alerts:\n'; alert_labels warning MawareethBackupIncomplete
    printf '      - {eval_time: 9m, alertname: MawareethBackupIncomplete, exp_alerts: []}\n'
    # The gauge is absent (rules updated before the host's monitor.sh): it
    # fires while the last result is ok, and not once it is not.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'mawareeth_backup_last_result_ok{%s}', values: '1x3 0x4'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - eval_time: 2m\n        alertname: MawareethBackupIncomplete\n        exp_alerts:\n          - exp_labels: {severity: warning, project: mawareeth, alertname: MawareethBackupIncomplete, job: mawareeth-node}\n'
    printf '      - {eval_time: 6m, alertname: MawareethBackupIncomplete, exp_alerts: []}\n'
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
    # Drill: fires at once while a code is published, silent at 0.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'mawareeth_drill_active_code{%s}', values: '0x2 123456x5 0x3'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 1m, alertname: MawareethAlertDrill, exp_alerts: []}\n'
    printf '      - eval_time: 3m\n        alertname: MawareethAlertDrill\n        exp_alerts:\n'; alert_labels info MawareethAlertDrill
    printf '      - {eval_time: 9m, alertname: MawareethAlertDrill, exp_alerts: []}\n'
    # Overdue: a pass at day 1 is due until day 93; never passed (0) fires past
    # 92 days from the epoch; future-dated beyond 300s fires, within it not.
    printf '  - interval: 1d\n    input_series:\n'
    printf "      - {series: 'mawareeth_drill_last_pass_timestamp_seconds{%s}', values: '86400x100'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 92d, alertname: MawareethDrillOverdue, exp_alerts: []}\n'
    printf '      - eval_time: 94d\n        alertname: MawareethDrillOverdue\n        exp_alerts:\n'; alert_labels warning MawareethDrillOverdue
    printf '  - interval: 1d\n    input_series:\n'
    printf "      - {series: 'mawareeth_drill_last_pass_timestamp_seconds{%s}', values: '0x100'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - eval_time: 93d\n        alertname: MawareethDrillOverdue\n        exp_alerts:\n'; alert_labels warning MawareethDrillOverdue
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'mawareeth_drill_last_pass_timestamp_seconds{%s}', values: '1000x5'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - eval_time: 1m\n        alertname: MawareethDrillOverdue\n        exp_alerts:\n'; alert_labels warning MawareethDrillOverdue
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'mawareeth_drill_last_pass_timestamp_seconds{%s}', values: '300x5'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 1m, alertname: MawareethDrillOverdue, exp_alerts: []}\n'
    # The drill metric is missing while the host is scraped: Overdue fires.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'up{%s}', values: '1x5'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - eval_time: 1m\n        alertname: MawareethDrillOverdue\n        exp_alerts:\n          - exp_labels: {severity: warning, project: mawareeth, alertname: MawareethDrillOverdue, job: mawareeth-node}\n'
    # Inodes: 80% used is fine; 90% used from 4m fires at 9m (for: 5m).
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_filesystem_files{%s,%s}', values: '1000x20'}\n" "$labels" "$disk"
    printf "      - {series: 'node_filesystem_files_free{%s,%s}', values: '200x3 100x16'}\n" "$labels" "$disk"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 3m, alertname: MawareethInodesLow, exp_alerts: []}\n'
    printf '      - {eval_time: 8m, alertname: MawareethInodesLow, exp_alerts: []}\n'
    printf '      - eval_time: 10m\n        alertname: MawareethInodesLow\n        exp_alerts:\n'; alert_labels critical MawareethInodesLow "$disk_yaml"
    # btrfs reports files == 0 (and files_free == 0): never fires.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_filesystem_files{%s,%s}', values: '0x20'}\n" "$labels" "$btrfs"
    printf "      - {series: 'node_filesystem_files_free{%s,%s}', values: '0x20'}\n" "$labels" "$btrfs"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 15m, alertname: MawareethInodesLow, exp_alerts: []}\n'
    # Read-only from 3m fires at 5m (for: 2m).
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_filesystem_readonly{%s,%s}', values: '0x2 1x10'}\n" "$labels" "$disk"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 2m, alertname: MawareethFilesystemReadOnly, exp_alerts: []}\n'
    printf '      - {eval_time: 4m, alertname: MawareethFilesystemReadOnly, exp_alerts: []}\n'
    printf '      - eval_time: 6m\n        alertname: MawareethFilesystemReadOnly\n        exp_alerts:\n'; alert_labels critical MawareethFilesystemReadOnly "$disk_yaml"
    # Memory: MemAvailable 5% from 3m fires at 13m (for: 10m).
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_memory_MemTotal_bytes{%s}', values: '1000x20'}\n" "$labels"
    printf "      - {series: 'node_memory_MemAvailable_bytes{%s}', values: '500x2 50x18'}\n" "$labels"
    printf "      - {series: 'node_memory_SwapTotal_bytes{%s}', values: '1000x20'}\n" "$labels"
    printf "      - {series: 'node_memory_SwapFree_bytes{%s}', values: '1000x20'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 2m, alertname: MawareethMemoryPressure, exp_alerts: []}\n'
    printf '      - {eval_time: 12m, alertname: MawareethMemoryPressure, exp_alerts: []}\n'
    printf '      - eval_time: 14m\n        alertname: MawareethMemoryPressure\n        exp_alerts:\n'; alert_labels warning MawareethMemoryPressure
    # Swap 60% used from 3m fires at 13m.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_memory_MemTotal_bytes{%s}', values: '1000x20'}\n" "$labels"
    printf "      - {series: 'node_memory_MemAvailable_bytes{%s}', values: '500x20'}\n" "$labels"
    printf "      - {series: 'node_memory_SwapTotal_bytes{%s}', values: '1000x20'}\n" "$labels"
    printf "      - {series: 'node_memory_SwapFree_bytes{%s}', values: '1000x2 400x18'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 2m, alertname: MawareethMemoryPressure, exp_alerts: []}\n'
    printf '      - {eval_time: 12m, alertname: MawareethMemoryPressure, exp_alerts: []}\n'
    printf '      - eval_time: 14m\n        alertname: MawareethMemoryPressure\n        exp_alerts:\n'; alert_labels warning MawareethMemoryPressure
    # Swap 40% used, held for 25m, never fires.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_memory_MemTotal_bytes{%s}', values: '1000x25'}\n" "$labels"
    printf "      - {series: 'node_memory_MemAvailable_bytes{%s}', values: '500x25'}\n" "$labels"
    printf "      - {series: 'node_memory_SwapTotal_bytes{%s}', values: '1000x25'}\n" "$labels"
    printf "      - {series: 'node_memory_SwapFree_bytes{%s}', values: '600x25'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 12m, alertname: MawareethMemoryPressure, exp_alerts: []}\n'
    printf '      - {eval_time: 24m, alertname: MawareethMemoryPressure, exp_alerts: []}\n'
    # Swapless host: SwapTotal == 0 never fires the swap branch.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_memory_MemTotal_bytes{%s}', values: '1000x20'}\n" "$labels"
    printf "      - {series: 'node_memory_MemAvailable_bytes{%s}', values: '500x20'}\n" "$labels"
    printf "      - {series: 'node_memory_SwapTotal_bytes{%s}', values: '0x20'}\n" "$labels"
    printf "      - {series: 'node_memory_SwapFree_bytes{%s}', values: '0x20'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 15m, alertname: MawareethMemoryPressure, exp_alerts: []}\n'
    # OOM: a kill at 6m fires at once and resolves once 10m pass without one.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_vmstat_oom_kill{%s}', values: '0x5 1x15'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 5m, alertname: MawareethOOMKill, exp_alerts: []}\n'
    printf '      - eval_time: 6m\n        alertname: MawareethOOMKill\n        exp_alerts:\n'; alert_labels warning MawareethOOMKill
    printf '      - eval_time: 14m\n        alertname: MawareethOOMKill\n        exp_alerts:\n'; alert_labels warning MawareethOOMKill
    printf '      - {eval_time: 17m, alertname: MawareethOOMKill, exp_alerts: []}\n'
    # A unit failed from 3m fires at 8m (for: 5m), labelled with its name.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_systemd_unit_state{%s,%s}', values: '0x2 1x10'}\n" "$labels" "$unit"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 2m, alertname: MawareethSystemdUnitFailed, exp_alerts: []}\n'
    printf '      - {eval_time: 7m, alertname: MawareethSystemdUnitFailed, exp_alerts: []}\n'
    printf '      - eval_time: 9m\n        alertname: MawareethSystemdUnitFailed\n        exp_alerts:\n'; alert_labels warning MawareethSystemdUnitFailed "$unit_yaml"
    # Systemd collector off (old wrapper): no unit series at all fires at 5m,
    # without a unit name.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'up{%s}', values: '1x10'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 4m, alertname: MawareethSystemdUnitFailed, exp_alerts: []}\n'
    printf '      - eval_time: 6m\n        alertname: MawareethSystemdUnitFailed\n        exp_alerts:\n          - exp_labels: {severity: warning, project: mawareeth, alertname: MawareethSystemdUnitFailed, job: mawareeth-node}\n'
    # Clock: unsynchronised from 3m fires at 13m (for: 10m).
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_timex_sync_status{%s}', values: '1x2 0x18'}\n" "$labels"
    printf "      - {series: 'node_timex_offset_seconds{%s}', values: '0x20'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 2m, alertname: MawareethClockUnsynced, exp_alerts: []}\n'
    printf '      - {eval_time: 12m, alertname: MawareethClockUnsynced, exp_alerts: []}\n'
    printf '      - eval_time: 14m\n        alertname: MawareethClockUnsynced\n        exp_alerts:\n'; alert_labels warning MawareethClockUnsynced
    # Synchronised but offset -0.8s from 3m fires at 13m.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_timex_sync_status{%s}', values: '1x20'}\n" "$labels"
    printf "      - {series: 'node_timex_offset_seconds{%s}', values: '0x2 -0.8x18'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 2m, alertname: MawareethClockUnsynced, exp_alerts: []}\n'
    printf '      - {eval_time: 12m, alertname: MawareethClockUnsynced, exp_alerts: []}\n'
    printf '      - eval_time: 14m\n        alertname: MawareethClockUnsynced\n        exp_alerts:\n'; alert_labels warning MawareethClockUnsynced
    # Synchronised with a 0.4s offset held for 25m never fires.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'node_timex_sync_status{%s}', values: '1x25'}\n" "$labels"
    printf "      - {series: 'node_timex_offset_seconds{%s}', values: '0.4x25'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - {eval_time: 12m, alertname: MawareethClockUnsynced, exp_alerts: []}\n'
    printf '      - {eval_time: 24m, alertname: MawareethClockUnsynced, exp_alerts: []}\n'
    # The Watchdog fires at once with no input at all, and while the host is down.
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'up{%s}', values: '0x10'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - eval_time: 0m\n        alertname: MawareethWatchdog\n        exp_alerts:\n%s\n' "$watchdog_labels"
    printf '      - eval_time: 5m\n        alertname: MawareethHostDown\n        exp_alerts:\n'; alert_labels critical MawareethHostDown
    printf '      - eval_time: 5m\n        alertname: MawareethWatchdog\n        exp_alerts:\n%s\n' "$watchdog_labels"
  } > "$tmp/alerts.test.yml"
  # The drill email carries the code: check the rendered summary against the
  # unstripped rules.
  cp "$alerts" "$tmp/drill-alerts.yml"
  {
    printf 'rule_files: [drill-alerts.yml]\nevaluation_interval: 1m\ntests:\n'
    printf '  - interval: 1m\n    input_series:\n'
    printf "      - {series: 'mawareeth_drill_active_code{%s}', values: '654321x5'}\n" "$labels"
    printf '    alert_rule_test:\n'
    printf '      - eval_time: 1m\n        alertname: MawareethAlertDrill\n        exp_alerts:\n'; alert_labels info MawareethAlertDrill
    printf "            exp_annotations:\n"
    printf "              summary: 'Mawareeth alert-path drill code 654321'\n"
    printf "              description: '%s'\n" "$(sed -n '/alert: MawareethAlertDrill/,/runbook:/s/^ *description: '"'"'\(.*\)'"'"'$/\1/p' "$alerts" | sed 's/{{ $labels.alias }}/mawareeth-prod/')"
    printf "              runbook: 'deploy/README.md#runbook-mawareethalertdrill'\n"
  } > "$tmp/drill.test.yml"
  promtool test rules "$tmp/drill.test.yml" > "$tmp/out" 2>&1 || fail 'promtool drill annotation test failed (the email must carry the code)'
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
  } | sed 's/\${SMTP_TO}/ops@example.invalid/; s|\${MAWAREETH_HEARTBEAT_URL}|https://heartbeat.example.invalid/ping|' > "$tmp/alertmanager.yml"
  ! grep -Fq '${' "$tmp/alertmanager.yml" || fail 'a ${...} placeholder survived into the Alertmanager config'
  amtool check-config "$tmp/alertmanager.yml" > "$tmp/out" 2>&1 || fail 'amtool check-config rejected the route snippet'
  amtool config routes test --config.file="$tmp/alertmanager.yml" --verify.receivers=mawareeth-email project=mawareeth > "$tmp/out" 2>&1 \
    || fail 'project=mawareeth does not route to mawareeth-email'
  amtool config routes test --config.file="$tmp/alertmanager.yml" --verify.receivers=mawareeth-email \
    project=mawareeth severity=info alertname=MawareethAlertDrill > "$tmp/out" 2>&1 || fail 'the info-severity drill alert does not route to mawareeth-email'
  amtool config routes test --config.file="$tmp/alertmanager.yml" --verify.receivers=scdf-default project=scdf > "$tmp/out" 2>&1 \
    || fail 'the Mawareeth route captured another project'
  # The Watchdog goes only to the heartbeat (--verify.receivers compares the
  # full receiver list), never to email; other alerts never to the heartbeat.
  amtool config routes test --config.file="$tmp/alertmanager.yml" --verify.receivers=mawareeth-heartbeat \
    alertname=MawareethWatchdog project=mawareeth > "$tmp/out" 2>&1 || fail 'MawareethWatchdog does not route only to mawareeth-heartbeat'
  amtool config routes test --config.file="$tmp/alertmanager.yml" --verify.receivers=mawareeth-heartbeat \
    alertname=MawareethWatchdog project=mawareeth severity=heartbeat > "$tmp/out" 2>&1 || fail 'MawareethWatchdog with its severity does not route only to mawareeth-heartbeat'
  for name in MawareethHostDown $host_rules; do
    amtool config routes test --config.file="$tmp/alertmanager.yml" --verify.receivers=mawareeth-email \
      alertname="$name" project=mawareeth > "$tmp/out" 2>&1 || fail "$name does not route to mawareeth-email"
  done
  # amtool cannot evaluate inhibit rules; the parsed config must still carry
  # the Watchdog exclusion on the HostDown inhibit (checked statically above).
  grep -Fq 'alertname!="MawareethWatchdog"' "$tmp/alertmanager.yml" || fail 'the merged config lost the Watchdog inhibit exclusion'
  printf 'amtool route checks passed\n'
else
  missing_tool amtool 'Alertmanager route checks'
fi

printf 'deploy/monitor.sh tests passed\n'
