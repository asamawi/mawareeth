#!/usr/bin/env bash
# Safe blue-green release deployment for the private Compose runtime.
#
#   sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/release.sh deploy
#
# Exit codes: 0 deployed and verified; 2 refused before any mutation; 3 another
# deploy or runtime operation holds the lock; 4 the journal is not idle or is
# unsafe (manual recovery required); 5 the candidate failed before routing
# (route unchanged, candidate stopped); 6 the switch or production TLS
# verification failed and the prior state was restored (bootstrap: Caddy
# stopped); 7 restoring the prior state failed or could not be confirmed
# (CRITICAL, journal left non-idle); 8 the verified release serves traffic but
# the deploy could not finish draining or journaling (journal left non-idle);
# 129/130/143 a hangup, interrupt, or termination arrived before any mutation
# (nothing changed). Signals after mutation begins map to 5, 6 or 8.
release_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/runtime.sh
source "$release_dir/runtime.sh"

live_timeout="${MAWAREETH_DEPLOY_LIVE_TIMEOUT:-120}"
ready_timeout="${MAWAREETH_DEPLOY_READY_TIMEOUT:-180}"
migrate_timeout="${MAWAREETH_DEPLOY_MIGRATE_TIMEOUT:-900}"
verify_timeout="${MAWAREETH_DEPLOY_VERIFY_TIMEOUT:-60}"
poll_interval="${MAWAREETH_DEPLOY_POLL_INTERVAL:-2}"
command_timeout=60
probe_timeout=15
stop_seconds=35
caddy_state_attempts=3

mode=normal
phase=idle
prior_slot=''
candidate_slot=''
prior_image=''
prior_commit=''
prior_snapshot=''
candidate_had_record=0
candidate_record_backup=''
prev_had=0
prev_backup=''
route_written=0
stage=preflight
handling_failure=0
deadline=''
started_at=''
deploy_log=/dev/null
migrate_log=/dev/null

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Terminal output must never abort a deploy, e.g. after the operator's session
# closed its stderr.
say() {
  # stdout goes to the original stderr; only printf's own errors are discarded.
  printf 'release: %s\n' "$*" >&2 2>/dev/null || true
  if [[ "$deploy_log" != /dev/null ]]; then
    printf '%s release: %s\n' "$(now)" "$*" >> "$deploy_log" 2>/dev/null || true
  fi
}
fail_with() { local code="$1"; shift; say "$*"; exit "$code"; }
# fail_verified: the candidate is verified and serving; leave the journal
# non-idle for recovery and do not roll back.
fail_verified() { handling_failure=1; fail_with 8 "$@"; }

bounded_seconds() {
  [[ "$1" =~ ^[1-9][0-9]{0,3}$ ]] || fail_with 2 "$2 must be 1-9999 seconds"
}

journal_content() {
  printf 'phase=%s\nprior_slot=%s\ncandidate_slot=%s\nmanifest_commit=%s\nprior_commit=%s\nresult=%s\nstarted_at=%s\nupdated_at=%s\ndeploy_log=%s\nmigrate_log=%s\n' \
    "$1" "$prior_slot" "$candidate_slot" "$APP_COMMIT" "$prior_commit" "$2" "$started_at" "$(now)" "$deploy_log" "$migrate_log"
}

# journal PHASE [RESULT] publishes the phase atomically before the caller acts
# on it; the in-memory phase changes only once the journal is durable.
journal() {
  atomic_write "$journal_file" 0600 "$(journal_content "$1" "${2:-in-progress}")" || return 1
  phase="$1"
}

# One root-only diagnostic log pair per deploy; command output that may carry
# connection details is kept here instead of the terminal.
open_logs() {
  local logs_dir="$state_dir/logs" stamp file
  state_subdir "$logs_dir" 700 create
  stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  for file in "$logs_dir/deploy-$stamp.log" "$logs_dir/migrate-$stamp.log"; do
    (set -C; : > "$file") 2>/dev/null || die "cannot create diagnostic log $file"
    { chown root:root "$file" && chmod 0600 "$file"; } || die "cannot protect diagnostic log $file"
    file_metadata "$file" 600 'diagnostic log'
  done
  deploy_log="$logs_dir/deploy-$stamp.log"
  migrate_log="$logs_dir/migrate-$stamp.log"
}

# wait_until SECONDS COMMAND... retries COMMAND until it succeeds or the
# deadline passes; each attempt is capped at the remaining time.
wait_until() {
  local limit="$1" pause; shift
  deadline=$((SECONDS + limit))
  while :; do
    if "$@"; then deadline=''; return 0; fi
    if ((SECONDS >= deadline)); then deadline=''; return 1; fi
    pause="$poll_interval"
    if ((deadline - SECONDS < pause)); then pause=$((deadline - SECONDS)); fi
    sleep "$pause"
  done
}

attempt_limit() {
  local limit="$probe_timeout" remaining
  if [[ -n "$deadline" ]]; then
    remaining=$((deadline - SECONDS))
    if ((remaining < 1)); then remaining=1; fi
    if ((remaining < limit)); then limit="$remaining"; fi
  fi
  printf '%s\n' "$limit"
}

# probe SLOT PATH prints a slot endpoint body fetched from inside its container.
probe() {
  local limit
  limit="$(attempt_limit)"
  compose_bounded "$limit" exec -T "app-$1" python -c \
    'import sys, urllib.request; r = urllib.request.urlopen("http://127.0.0.1:8000" + sys.argv[1], timeout=float(sys.argv[2])); sys.stdout.write(r.read(4096).decode("utf-8", "replace"))' \
    "$2" "$limit" 2>>"$deploy_log"
}

json_commit() {
  python3 -I -c 'import json, sys
try:
    value = json.loads(sys.stdin.read())
    print(value.get("commit", "") if isinstance(value, dict) else "")
except ValueError:
    print("")' | tr -d '\r'
}

slot_ready() { probe "$1" /health/ready/ >/dev/null; }
prior_ready() { slot_ready "$prior_slot"; }
candidate_live() { probe "$candidate_slot" /health/live/ >/dev/null; }
candidate_ready() { slot_ready "$candidate_slot"; }
candidate_identity() {
  local body
  body="$(probe "$candidate_slot" /health/release/)" || return 1
  [[ "$(json_commit <<<"$body")" == "$APP_COMMIT" ]]
}

# running_image_matches SERVICE IMAGE succeeds when the running container was
# created from exactly the local image IMAGE resolves to.
running_image_matches() {
  local id actual expected
  id="$(compose_bounded "$command_timeout" ps --quiet "$1" 2>>"$deploy_log")" || return 1
  id="${id//$'\r'/}"
  [[ -n "$id" && "$id" != *$'\n'* ]] || return 1
  actual="$(docker inspect --format '{{.Image}}' "$id" 2>>"$deploy_log" 9>&-)" || return 1
  expected="$(docker image inspect --format '{{.Id}}' "$2" 2>>"$deploy_log" 9>&-)" || return 1
  actual="${actual//$'\r'/}"; expected="${expected//$'\r'/}"
  [[ "$expected" =~ ^sha256:[0-9a-f]{64}$ && "$actual" == "$expected" ]]
}

# Fetch through the production edge on this host with full certificate
# validation; headers precede the body on stdout.
edge_fetch() {
  local limit
  limit="$(attempt_limit)"
  curl --fail --silent --show-error --proto '=https' --max-time "$limit" --dump-header - \
    --resolve "${runtime_values[DOMAIN]}:443:127.0.0.1" "https://${runtime_values[DOMAIN]}$1" 2>>"$deploy_log"
}

# edge_serves SLOT COMMIT succeeds only when the edge answers through SLOT
# (its X-Mawareeth-Slot header), reports COMMIT, and is ready.
edge_serves() {
  local response headers body line served=''
  response="$(edge_fetch /health/release/)" || return 1
  response="${response//$'\r'/}"
  [[ "$response" == *$'\n\n'* ]] || return 1
  headers="${response%%$'\n\n'*}"; body="${response#*$'\n\n'}"
  while [[ "$body" == HTTP/* && "$body" == *$'\n\n'* ]]; do
    headers="${body%%$'\n\n'*}"; body="${body#*$'\n\n'}"
  done
  while IFS= read -r line; do
    if [[ "${line,,}" == x-mawareeth-slot:* ]]; then served="${line#*:}"; served="${served//[[:space:]]/}"; fi
  done <<<"$headers"
  [[ -n "$served" && "$served" == "$1" ]] || return 1
  [[ "$(json_commit <<<"$body")" == "$2" ]] || return 1
  edge_fetch /health/ready/ >/dev/null
}
edge_candidate() { edge_serves "$candidate_slot" "$APP_COMMIT"; }
edge_prior() { edge_serves "$prior_slot" "$prior_commit"; }

# caddy_running returns 0 when running, 1 when absent or stopped, and 2 when
# the state cannot be determined or Caddy is paused. Compose errors and the
# transient restarting state are retried a bounded number of times.
caddy_running() {
  local attempt state
  for ((attempt = 1; attempt <= caddy_state_attempts; attempt++)); do
    if state="$(compose_bounded "$command_timeout" ps --all --format '{{.State}}' caddy 2>>"$deploy_log")"; then
      state="${state//$'\r'/}"
      case "$state" in
        running) return 0 ;;
        ''|created|exited|dead) return 1 ;;
        paused) say 'Caddy is paused; unpause or restart it deliberately'; return 2 ;;
        restarting) say "Caddy is restarting (attempt $attempt of $caddy_state_attempts)" ;;
        *) say "Caddy reported an unexpected state (attempt $attempt of $caddy_state_attempts)" ;;
      esac
    else
      say "Compose ps failed while reading the Caddy state (attempt $attempt of $caddy_state_attempts)"
    fi
    if ((attempt < caddy_state_attempts)); then sleep "$poll_interval"; fi
  done
  say 'cannot determine whether Caddy is running'
  return 2
}

# Apply the persisted route: reload a running Caddy, or start a stopped one.
apply_route() {
  local status=0
  caddy_running || status=$?
  case "$status" in
    0) compose_bounded "$command_timeout" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >>"$deploy_log" 2>&1 ;;
    1) compose_bounded "$command_timeout" up -d --no-build --pull never --no-deps caddy >>"$deploy_log" 2>&1 ;;
    *) return 1 ;;
  esac
}

stop_service() {
  compose_bounded $((stop_seconds + 30)) stop -t "$stop_seconds" "$1" >>"$deploy_log" 2>&1
}

# Put the candidate's record and its .prev back exactly as they were.
restore_candidate_records() {
  local record="$slots_dir/$candidate_slot.env"
  if ((candidate_had_record)); then atomic_write "$record" 0600 "$candidate_record_backup" || return 1
  else rm -f -- "$record" || return 1; fi
  if ((prev_had)); then atomic_write "$record.prev" 0600 "$prev_backup" || return 1
  else rm -f -- "$record.prev" || return 1; fi
}

# Failure before the route changes: the prior route never moved.
abort_candidate() {
  trap '' INT TERM HUP
  local reason="$1" failed_phase="$phase"
  handling_failure=1
  say "$reason"
  if [[ "$mode" == bootstrap ]]; then say 'no route was published; nothing is served from the candidate'
  else say "route unchanged: production stays on app-$prior_slot"; fi
  stop_service "app-$candidate_slot" || say "WARNING: could not stop app-$candidate_slot; stop it manually"
  journal idle "failed:$failed_phase" || say "WARNING: could not reset $journal_file to idle"
  say "diagnostics: $deploy_log"
  exit 5
}

restore_failed() {
  local failed_phase="$1"; shift
  journal restore-failed "failed:$failed_phase" || true
  say "CRITICAL: $*"
  say "follow the manual recovery steps in deploy/README.md using $journal_file; diagnostics: $deploy_log"
  exit 7
}

# Failure after the switch began: restore the prior route only if it was
# changed and keep the old slot serving; for bootstrap, stop Caddy so nothing
# unverified is served.
abort_switch() {
  trap '' INT TERM HUP
  local reason="$1" failed_phase="$phase"
  handling_failure=1
  say "$reason"
  if ((route_written == 0)); then
    say 'the persisted route was never changed'
  elif [[ "$mode" == bootstrap ]]; then
    say 'stopping Caddy so no route is served from the unverified candidate'
    stop_service caddy || restore_failed "$failed_phase" "Caddy could not be stopped and may serve unverified app-$candidate_slot"
  else
    say "restoring the prior route to app-$prior_slot"
    atomic_write "$route_file" 0644 "$(route_content "$prior_slot")" \
      || restore_failed "$failed_phase" "the prior route file could not be restored; Caddy may target unverified app-$candidate_slot"
    apply_route || restore_failed "$failed_phase" "Caddy could not reload the prior route; it may target unverified app-$candidate_slot"
    wait_until "$verify_timeout" edge_prior \
      || restore_failed "$failed_phase" "the edge does not confirm app-$prior_slot at $prior_commit after the restore"
  fi
  restore_candidate_records \
    || restore_failed "$failed_phase" "the route is safe, but the $candidate_slot slot records could not be restored"
  stop_service "app-$candidate_slot" || say "WARNING: could not stop app-$candidate_slot; stop it manually"
  journal idle "failed:$failed_phase" || say "WARNING: could not reset $journal_file to idle"
  if [[ "$mode" == bootstrap ]]; then say 'bootstrap rolled back: Caddy and the candidate are stopped'
  elif ((route_written)); then say "prior route restored and confirmed: production stays on app-$prior_slot"
  else say "production stays on app-$prior_slot"; fi
  say "diagnostics: $deploy_log"
  exit 6
}

# Safety net for unexpected errors, set -e, and signals after mutation begins.
on_exit() {
  local status=$?
  ((status != 0 && handling_failure == 0)) || return 0
  case "$stage" in
    candidate) abort_candidate "unexpected exit (status $status) during $phase" ;;
    switched) abort_switch "unexpected exit (status $status) during $phase" ;;
    verified)
      handling_failure=1
      trap '' INT TERM HUP
      journal "$phase" verified || true
      say "app-$candidate_slot is verified and serving, but the deploy stopped unexpectedly (status $status) during $phase; journal left non-idle"
      exit 8 ;;
  esac
}

require_volumes() {
  local name
  for name in mawareeth-postgres-data mawareeth-caddy-data mawareeth-caddy-config; do
    volume_exists "$name" || die "volume $name is missing; run deploy/runtime.sh prepare first"
    validate_existing_volume "$name" "$(volume_spec "$name")"
  done
}

# select_slots chooses the idle candidate from the persisted route, or bootstrap
# mode when no release has ever been recorded.
select_slots() {
  if read_active_slot; then
    if read_slot_record "$ACTIVE_SLOT"; then
      prior_slot="$ACTIVE_SLOT"; prior_image="$SLOT_IMAGE"; prior_commit="$SLOT_COMMIT"; prior_snapshot="$SLOT_SNAPSHOT"
      candidate_slot="$(other_slot "$prior_slot")"
      return 0
    fi
    if any_slot_record || [[ "$ACTIVE_SLOT" != blue ]]; then
      die "app-$ACTIVE_SLOT is routed but has no release record; follow the manual recovery steps in deploy/README.md"
    fi
  else
    ! any_slot_record || die "persisted route $route_file is missing but slot records exist; follow the manual recovery steps in deploy/README.md"
    route_seed_content >/dev/null
  fi
  mode=bootstrap
  candidate_slot=blue
}

# A reload cannot fix a Caddy container created from another Compose model
# (for example the 0.5 tracked-route mount), so require the current one.
require_current_caddy() {
  local id actual expected
  id="$(compose_bounded "$command_timeout" ps --quiet caddy 2>>"$deploy_log")" || fail_with 2 'cannot inspect the Caddy container'
  id="${id//$'\r'/}"
  [[ -n "$id" ]] || fail_with 2 'Caddy is not running; run deploy/runtime.sh up first'
  actual="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$id" 2>>"$deploy_log" 9>&-)" \
    || fail_with 2 'cannot read the Caddy container configuration hash'
  expected="$(compose_bounded "$command_timeout" config --hash caddy 2>>"$deploy_log")" || fail_with 2 'cannot compute the Caddy configuration hash'
  actual="${actual//$'\r'/}"; expected="${expected//$'\r'/}"; expected="${expected##* }"
  [[ -n "$expected" && "$actual" == "$expected" ]] \
    || fail_with 2 'the running Caddy container was created from a different Compose model (stale route mount); run deploy/runtime.sh up first'
}

# Bootstrap must not take over a live runtime that predates slot records.
refuse_live_legacy_runtime() {
  local service id
  for service in app-blue app-green caddy; do
    id="$(compose_bounded "$command_timeout" ps --quiet "$service" 2>>"$deploy_log")" || fail_with 2 "cannot inspect $service"
    [[ -z "${id//$'\r'/}" ]] \
      || fail_with 2 "$service is running but no slot release is recorded (a pre-0.6 runtime is live); migrate it manually as described in deploy/README.md before bootstrapping"
  done
}

deploy() {
  local status=0 drift hash
  [[ ${EUID:-999} -eq 0 ]] || fail_with 2 'must run as root'
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap '' PIPE
  require_command flock; require_command curl; require_command timeout; require_command git; require_command sync
  bounded_seconds "$live_timeout" MAWAREETH_DEPLOY_LIVE_TIMEOUT
  bounded_seconds "$ready_timeout" MAWAREETH_DEPLOY_READY_TIMEOUT
  bounded_seconds "$migrate_timeout" MAWAREETH_DEPLOY_MIGRATE_TIMEOUT
  bounded_seconds "$verify_timeout" MAWAREETH_DEPLOY_VERIFY_TIMEOUT
  bounded_seconds "$poll_interval" MAWAREETH_DEPLOY_POLL_INTERVAL
  bounded_seconds "$startup_timeout" MAWAREETH_RUNTIME_WAIT_TIMEOUT
  safe_path "$state_dir" MAWAREETH_RUNTIME_DIR
  ensure_state_dir existing
  started_at="$(now)"

  acquire_deploy_lock || fail_with 3 "another deploy or runtime operation holds $deploy_lock_file"
  journal_status || status=$?
  case "$status" in
    0) ;;
    1) fail_with 4 "$(journal_refusal 'is not idle')" ;;
    *) fail_with 4 "$(journal_refusal 'is unsafe or malformed')" ;;
  esac
  drift="$(git -C "$root" status --porcelain -- deploy 2>/dev/null)" || fail_with 2 'cannot inspect the deployment bundle with git status'
  [[ -z "$drift" ]] || fail_with 2 'the deployment bundle has uncommitted changes under deploy/; deploy only a clean checkout of the release commit'

  preflight
  validate_compose_model
  ensure_state_subdirs existing
  select_slots
  hash="$(snapshot_hash)" || die 'cannot hash the runtime configuration'
  if [[ "$mode" == normal && "$hash.snapshot.env" != "$prior_snapshot" ]]; then
    fail_with 2 'runtime configuration differs from the active slot snapshot; rotate configuration separately'
  fi
  use_existing_snapshot
  require_volumes
  if [[ -e "$slots_dir/$candidate_slot.env.prev" || -L "$slots_dir/$candidate_slot.env.prev" ]]; then
    file_metadata "$slots_dir/$candidate_slot.env.prev" 600 "$candidate_slot previous slot record"
    prev_had=1
    prev_backup="$(< "$slots_dir/$candidate_slot.env.prev")" || die "cannot read the $candidate_slot previous slot record"
  fi
  if read_slot_record "$candidate_slot"; then
    candidate_had_record=1
    candidate_record_backup="$(slot_record_content "$SLOT_IMAGE" "$SLOT_COMMIT" "$SLOT_SNAPSHOT")"
  fi
  if [[ "$mode" == normal ]]; then
    validate_image "$prior_image"
    if [[ "$candidate_slot" == blue ]]; then APP_BLUE_IMAGE="$APP_IMAGE"; APP_GREEN_IMAGE="$prior_image"
    else APP_GREEN_IMAGE="$APP_IMAGE"; APP_BLUE_IMAGE="$prior_image"; fi
  else
    APP_BLUE_IMAGE="$APP_IMAGE"; APP_GREEN_IMAGE="$APP_IMAGE"
  fi
  ROUTES_DIR="$routes_dir"

  open_logs
  if [[ "$mode" == normal ]]; then
    running_image_matches "app-$prior_slot" "$prior_image" \
      || fail_with 2 "active app-$prior_slot is not running its recorded image $prior_image; run deploy/runtime.sh up first"
    slot_ready "$prior_slot" || fail_with 2 "active app-$prior_slot is not ready; refusing to deploy over an unhealthy production slot"
    require_current_caddy
    wait_until "$verify_timeout" edge_prior \
      || fail_with 2 "the production edge does not confirm active app-$prior_slot at $prior_commit over verified TLS; fix the edge before deploying"
    say "deploying $APP_COMMIT to app-$candidate_slot (active: app-$prior_slot at $prior_commit)"
  else
    refuse_live_legacy_runtime
    say "bootstrapping $APP_COMMIT on app-$candidate_slot (no release recorded yet)"
  fi

  trap on_exit EXIT
  journal candidate-starting || fail_with 2 "cannot write $journal_file; nothing changed"
  stage=candidate
  if [[ "$mode" == bootstrap ]]; then
    compose_bounded $((startup_timeout + 30)) up -d --no-build --pull never --wait --wait-timeout "$startup_timeout" postgres >>"$deploy_log" 2>&1 \
      || abort_candidate 'PostgreSQL did not become healthy'
  fi
  compose_bounded "$command_timeout" up -d --no-build --pull never --no-deps --force-recreate "app-$candidate_slot" >>"$deploy_log" 2>&1 \
    || abort_candidate "app-$candidate_slot failed to start"
  running_image_matches "app-$candidate_slot" "$APP_IMAGE" || abort_candidate "app-$candidate_slot is not running the manifest image $APP_IMAGE"
  wait_until "$live_timeout" candidate_live || abort_candidate "app-$candidate_slot did not become live within ${live_timeout}s"

  journal migrating || abort_candidate "cannot write $journal_file"
  compose_bounded "$migrate_timeout" exec -T "app-$candidate_slot" python manage.py migrate --noinput > "$migrate_log" 2>&1 \
    || abort_candidate "migration failed; output withheld from the terminal and kept in root-only $migrate_log"

  wait_until "$ready_timeout" candidate_ready || abort_candidate "app-$candidate_slot did not become ready within ${ready_timeout}s"
  wait_until "$ready_timeout" candidate_identity || abort_candidate "app-$candidate_slot does not report release commit $APP_COMMIT"
  if [[ "$mode" == normal ]]; then
    wait_until "$verify_timeout" prior_ready \
      || abort_candidate "active app-$prior_slot stopped being ready after the migration; the migration may not be backward compatible (keep it serving and investigate)"
  fi
  journal candidate-ready || abort_candidate "cannot write $journal_file"

  journal switching || abort_candidate "cannot write $journal_file"
  stage=switched
  if ((candidate_had_record)); then
    atomic_write "$slots_dir/$candidate_slot.env.prev" 0600 "$candidate_record_backup" || abort_switch "cannot preserve the previous $candidate_slot slot record"
  else
    rm -f -- "$slots_dir/$candidate_slot.env.prev" || abort_switch "cannot clear the stale $candidate_slot.env.prev record"
  fi
  atomic_write "$slots_dir/$candidate_slot.env" 0600 "$(slot_record_content "$APP_IMAGE" "$APP_COMMIT" "${APP_SNAPSHOT##*/}")" \
    || abort_switch "cannot record the $candidate_slot slot release"
  route_written=1
  atomic_write "$route_file" 0644 "$(route_content "$candidate_slot")" || abort_switch 'cannot write the persisted route'
  apply_route || abort_switch 'Caddy reload failed'

  journal verifying || abort_switch "cannot write $journal_file"
  wait_until "$verify_timeout" edge_candidate \
    || abort_switch "production TLS verification of https://${runtime_values[DOMAIN]} did not confirm ready app-$candidate_slot at $APP_COMMIT within ${verify_timeout}s"

  stage=verified
  journal verifying verified || fail_verified "app-$candidate_slot is verified and serving, but $journal_file could not record it; app-$prior_slot is still running"
  if [[ "$mode" == bootstrap ]]; then
    journal idle success || fail_verified "app-$candidate_slot is verified and serving, but $journal_file could not be reset to idle"
    stage=complete
    say "bootstrapped $APP_COMMIT on app-$candidate_slot"
    return 0
  fi
  journal draining verified || fail_verified "app-$candidate_slot is verified and serving, but $journal_file could not be written; app-$prior_slot is still running"
  stop_service "app-$prior_slot" || fail_verified "app-$candidate_slot is verified and serving, but app-$prior_slot could not be stopped; journal left in draining"
  journal idle success || fail_verified "deploy finished but $journal_file could not be reset to idle"
  stage=complete
  say "deployed $APP_COMMIT on app-$candidate_slot; app-$prior_slot drained"
}

case "${1:-}" in
  deploy) shift; [[ $# -eq 0 ]] || fail_with 2 'usage: release.sh deploy'; deploy ;;
  *) fail_with 2 'usage: release.sh deploy' ;;
esac
