#!/usr/bin/env bash
# Safe blue-green release deployment for the private Compose runtime.
#
#   sudo MAWAREETH_RELEASE_MANIFEST=/etc/mawareeth/release-manifest.json deploy/release.sh deploy [--allow-contract]
#   sudo deploy/release.sh recover [--dry-run]
#
# Before migrating, deploy inspects `migrate --plan` and refuses (exit 5) a plan
# that removes, deletes or renames a field, model or table, or runs raw SQL or
# a custom state/database change: the still-serving prior slot could break.
# Pass --allow-contract only for a deliberate contract release whose prior slot
# no longer depends on what is changed.
#
# deploy exit codes: 0 deployed and verified; 2 refused before any mutation; 3
# another deploy or runtime operation holds the lock; 4 the journal is not idle
# or is unsafe (run recover); 5 the candidate failed before routing
# (route unchanged, candidate stopped); 6 the switch or production TLS
# verification failed and the prior state was restored (bootstrap: Caddy
# stopped); 7 restoring the prior state failed or could not be confirmed
# (CRITICAL, journal left non-idle); 8 the verified release serves traffic but
# the deploy could not finish draining or journaling (journal left non-idle);
# 129/130/143 a hangup, interrupt, or termination arrived before any mutation
# (nothing changed). Signals after mutation begins map to 5, 6 or 8.
#
# recover exit codes: 0 recovered, or nothing to recover (journal absent or
# idle), or a dry run printed its plan; 2 refused before any mutation (invalid
# arguments or input; the journal is malformed, unsafe, in the legacy ten-line
# format, or non-idle with result=success; slot records contradict it; the
# target's recorded snapshot is missing or drifted; the target's image is not
# loaded; or the runtime configuration differs from the target's recorded
# snapshot; recover manually); 3 another operation holds the lock (possibly a
# leftover process of the crashed deploy); 7 CRITICAL: recovery failed, or a
# signal arrived, after it began changing state (journal left unchanged; fix
# the cause and run recover again); 129/130/143 a signal arrived before any
# mutation (nothing changed).
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
records_state=untouched
stage=preflight
handling_failure=0
deadline=''
started_at=''
deploy_log=/dev/null
migrate_log=/dev/null
allow_contract=0
contract_pattern='^    (Remove field |Delete model |Rename field |Rename model |Rename table for |Raw SQL operation|Custom state/database change combination)'

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

# records= stays untouched until the candidate's .prev holds its pre-deploy
# record and becomes replaced from then on; recover restores the candidate
# record from .prev only when it reads replaced.
journal_content() {
  printf 'phase=%s\nprior_slot=%s\ncandidate_slot=%s\nmanifest_commit=%s\nprior_commit=%s\nresult=%s\nstarted_at=%s\nupdated_at=%s\ndeploy_log=%s\nmigrate_log=%s\nrecords=%s\n' \
    "$1" "$prior_slot" "$candidate_slot" "$APP_COMMIT" "$prior_commit" "$2" "$started_at" "$(now)" "$deploy_log" "$migrate_log" "$records_state"
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
# validation; headers precede the body on stdout. With EDGE_MODE=cloudflare
# Caddy serves a Cloudflare Origin CA certificate, which public trust stores do
# not contain, so verification uses the repository's pinned Origin CA roots.
edge_fetch() {
  local limit
  local -a trust=()
  limit="$(attempt_limit)"
  [[ "$(edge_mode)" != cloudflare ]] || trust=(--cacert "$origin_ca_bundle")
  curl --fail --silent --show-error --proto '=https' "${trust[@]}" --max-time "$limit" --dump-header - \
    --resolve "${runtime_values[DOMAIN]}:443:127.0.0.1" "https://${runtime_values[DOMAIN]}$1" 2>>"$deploy_log"
}

# edge_serves SLOT COMMIT succeeds only when the edge answers /health/ready/
# with success through SLOT (its X-Mawareeth-Slot header) and SLOT itself,
# probed directly, reports COMMIT. Caddy answers /health/release* with 404 for
# every client, so the commit is never read through the edge.
edge_serves() {
  local response headers body line served=''
  response="$(edge_fetch /health/ready/)" || return 1
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
  body="$(probe "$1" /health/release/)" || return 1
  [[ "$(json_commit <<<"$body")" == "$2" ]]
}
edge_candidate() { edge_serves "$candidate_slot" "$APP_COMMIT"; }

# edge_redirect succeeds when, in cloudflare mode, the REDIRECT_DOMAIN site on
# this host answers 301 with a Location on https://DOMAIN/, verified against the
# pinned Origin CA roots like the DOMAIN probe.
edge_redirect() {
  local limit result redirect="${runtime_values[REDIRECT_DOMAIN]}"
  limit="$(attempt_limit)"
  result="$(curl --silent --show-error --proto '=https' --cacert "$origin_ca_bundle" --max-time "$limit" \
    --output /dev/null --write-out '%{http_code} %{redirect_url}' \
    --resolve "$redirect:443:127.0.0.1" "https://$redirect/" 2>>"$deploy_log")" || return 1
  [[ "$result" == "301 https://${runtime_values[DOMAIN]}/"* ]]
}
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

# Put the candidate's record and its .prev back exactly as they were. While the
# journal says records=replaced, recover would restore the record from .prev,
# so .prev keeps the pre-deploy record until the journal says untouched again.
restore_candidate_records() {
  local record="$slots_dir/$candidate_slot.env"
  if ((candidate_had_record)); then atomic_write "$record" 0600 "$candidate_record_backup" || return 1
  else rm -f -- "$record" || return 1; fi
  if [[ "$records_state" == replaced ]]; then
    records_state=untouched
    if ! journal "$phase"; then
      records_state=replaced
      say "WARNING: $journal_file still says records=replaced, so $candidate_slot.env.prev keeps the pre-deploy record"
      return 0
    fi
  fi
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
  say "run deploy/release.sh recover now (see deploy/README.md); journal: $journal_file; diagnostics: $deploy_log"
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
  local status=0 drift hash plan_output plan_status=0
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

  # Contract gate: the plan (which may name tables and columns) goes only to
  # the root-only migrate log, never to the terminal. Only stdout is matched;
  # stderr (warnings, connection errors) goes straight to the log.
  plan_output="$(compose_bounded "$migrate_timeout" exec -T "app-$candidate_slot" python manage.py migrate --plan --no-color 2>>"$migrate_log")" \
    || plan_status=$?
  printf '%s\n' "$plan_output" >> "$migrate_log" || abort_candidate "cannot write $migrate_log"
  ((plan_status == 0)) \
    || abort_candidate "the migration plan could not be computed; output withheld from the terminal and kept in root-only $migrate_log"
  if grep -Eq "$contract_pattern" <<<"$plan_output"; then
    if ((allow_contract == 0)); then
      abort_candidate "the migration plan contains contract operations (remove, delete or rename, raw SQL, or a custom state/database change) that could break the still-serving slot; review the plan in root-only $migrate_log and rerun with release.sh deploy --allow-contract only if no serving release depends on them"
    fi
    printf 'release: contract operations allowed by --allow-contract\n' >> "$migrate_log" || abort_candidate "cannot write $migrate_log"
    say "contract operations in the migration plan were allowed by --allow-contract (plan in root-only $migrate_log)"
  fi

  journal migrating || abort_candidate "cannot write $journal_file"
  compose_bounded "$migrate_timeout" exec -T "app-$candidate_slot" python manage.py migrate --noinput >> "$migrate_log" 2>&1 \
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
  # .prev now holds the pre-deploy record (or is absent when there was none),
  # so recover may restore the candidate record from it. A failed write may
  # still have been published (only the directory sync failed), so keep
  # assuming replaced: the rollback then re-journals untouched before it puts
  # back the older .prev.
  records_state=replaced
  journal switching || abort_switch "cannot write $journal_file"
  atomic_write "$slots_dir/$candidate_slot.env" 0600 "$(slot_record_content "$APP_IMAGE" "$APP_COMMIT" "${APP_SNAPSHOT##*/}")" \
    || abort_switch "cannot record the $candidate_slot slot release"
  route_written=1
  atomic_write "$route_file" 0644 "$(route_content "$candidate_slot")" || abort_switch 'cannot write the persisted route'
  apply_route || abort_switch 'Caddy reload failed'

  journal verifying || abort_switch "cannot write $journal_file"
  wait_until "$verify_timeout" edge_candidate \
    || abort_switch "production TLS verification of https://${runtime_values[DOMAIN]} did not confirm ready app-$candidate_slot at $APP_COMMIT within ${verify_timeout}s"
  if [[ "$(edge_mode)" == cloudflare ]]; then
    wait_until "$verify_timeout" edge_redirect \
      || abort_switch "production TLS verification of https://${runtime_values[REDIRECT_DOMAIN]}/ did not answer a 301 redirect to https://${runtime_values[DOMAIN]}/ within ${verify_timeout}s"
  fi

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

# --- Crash recovery ------------------------------------------------------------
# recover [--dry-run] finishes or rolls back the deploy a non-idle journal
# describes, using only the journal and the slot records (no manifest).
recover_target=''
recover_commit=''
recover_record_action=none
recover_record_content=''

recover_refuse() {
  fail_with 2 "$*; nothing changed. Follow the manual recovery steps in deploy/README.md"
}

# After mutation began: leave the journal as it is so recover can simply be
# run again once the cause is fixed.
recover_failed() {
  handling_failure=1
  trap '' INT TERM HUP
  say "CRITICAL: $*"
  say "the journal $journal_file is unchanged; fix the cause and run deploy/release.sh recover again; diagnostics: $deploy_log"
  exit 7
}

recover_tmp=''
recover_cleanup() { [[ -z "$recover_tmp" ]] || rm -rf -- "$recover_tmp"; }

recover_on_exit() {
  local status=$?
  recover_cleanup
  ((status != 0 && handling_failure == 0)) || return 0
  [[ "$stage" == recovering ]] || return 0
  recover_failed "recover stopped unexpectedly (status $status)"
}

open_recover_log() {
  local logs_dir="$state_dir/logs" file
  state_subdir "$logs_dir" 700 create
  file="$logs_dir/recover-$(date -u +%Y%m%dT%H%M%SZ)-$$.log"
  (set -C; : > "$file") 2>/dev/null || die "cannot create diagnostic log $file"
  { chown root:root "$file" && chmod 0600 "$file"; } || die "cannot protect diagnostic log $file"
  file_metadata "$file" 600 'diagnostic log'
  deploy_log="$file"
}

# snapshot_valid FILE succeeds for a root-only snapshot whose content matches
# its content-addressed name.
snapshot_valid() {
  local file="$1"
  [[ "${file##*/}" =~ ^[0-9a-f]{64}\.snapshot\.env$ && -f "$file" && ! -L "$file" ]] || return 1
  [[ "$(stat -c '%u:%g:%a' "$file" 2>/dev/null)" == '0:0:600' ]] || return 1
  [[ "$(sha256sum "$file" | awk '{print $1}')" == "$(basename -- "$file" .snapshot.env)" ]]
}

# Start PostgreSQL (bounded) when it is not running; the target cannot become
# ready without it, and runtime.sh up refuses while the journal is not idle.
recover_postgres() {
  local id
  id="$(compose_bounded "$command_timeout" ps --quiet postgres 2>>"$deploy_log")" \
    || recover_failed 'cannot inspect PostgreSQL; nothing was changed by recover'
  [[ -z "${id//[[:space:]]/}" ]] || return 0
  say 'starting PostgreSQL'
  compose_bounded $((startup_timeout + 30)) up -d --no-build --pull never --wait --wait-timeout "$startup_timeout" postgres >>"$deploy_log" 2>&1 \
    || recover_failed "PostgreSQL did not become healthy within ${startup_timeout}s; the route, slot records and slots were not changed"
}

recover_target_ready() { slot_ready "$recover_target"; }
recover_target_identity() {
  local body
  body="$(probe "$recover_target" /health/release/)" || return 1
  [[ "$(json_commit <<<"$body")" == "$recover_commit" ]]
}
recover_target_edge() { edge_serves "$recover_target" "$recover_commit"; }

# Put the abandoned candidate's record back from .prev, or remove it when the
# slot had no record before the deploy. Idempotent, so a rerun is safe.
recover_records() {
  local record="$slots_dir/$candidate_slot.env"
  case "$recover_record_action" in
    restore) atomic_write "$record" 0600 "$recover_record_content" ;;
    remove) rm -f -- "$record" ;;
    *) return 0 ;;
  esac
}

# Reset the journal to idle with the deploy's own identity and log paths; the
# records now match what runs, so records=untouched.
recover_journal_idle() {
  local own_log="$deploy_log" status=0
  records_state=untouched
  deploy_log="${journal_values[deploy_log]}"; migrate_log="${journal_values[migrate_log]}"
  journal idle "$1" || status=1
  deploy_log="$own_log"
  return "$status"
}

recover() {
  local dry_run="$1" status=0 verified=0 current_route='' other='' snapshot image fallback slot final_result
  local record_file current_content caddy_status target_image='' hash
  [[ ${EUID:-999} -eq 0 ]] || fail_with 2 'must run as root'
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap '' PIPE
  require_command flock; require_command curl; require_command timeout; require_command sync
  bounded_seconds "$ready_timeout" MAWAREETH_DEPLOY_READY_TIMEOUT
  bounded_seconds "$verify_timeout" MAWAREETH_DEPLOY_VERIFY_TIMEOUT
  bounded_seconds "$poll_interval" MAWAREETH_DEPLOY_POLL_INTERVAL
  bounded_seconds "$startup_timeout" MAWAREETH_RUNTIME_WAIT_TIMEOUT
  safe_path "$state_dir" MAWAREETH_RUNTIME_DIR
  if [[ ! -e "$state_dir" && ! -L "$state_dir" ]]; then
    say "nothing to recover: the runtime state directory $state_dir does not exist"
    return 0
  fi
  ensure_state_dir existing

  acquire_deploy_lock || fail_with 3 "another deploy or runtime operation holds $deploy_lock_file"
  journal_status || status=$?
  case "$status" in
    0) say "nothing to recover: $journal_file is absent or idle"; return 0 ;;
    1) ;;
    *) recover_refuse "deploy journal $journal_file is unsafe or malformed" ;;
  esac
  [[ -n "${journal_values[records]}" ]] \
    || recover_refuse "deploy journal $journal_file uses the legacy ten-line format without records=, so recover cannot tell whether slot records were replaced"
  prior_slot="${journal_values[prior_slot]}"; candidate_slot="${journal_values[candidate_slot]}"
  APP_COMMIT="${journal_values[manifest_commit]}"; prior_commit="${journal_values[prior_commit]}"
  started_at="${journal_values[started_at]}"; records_state="${journal_values[records]}"
  [[ "$prior_slot" != "$candidate_slot" ]] || recover_refuse 'the journal names the same slot as prior and candidate'
  [[ -z "$prior_slot" && -z "$prior_commit" || -n "$prior_slot" && -n "$prior_commit" ]] \
    || recover_refuse 'the journal has a prior slot without a prior commit, or the reverse'
  [[ "${journal_values[result]}" != success ]] \
    || recover_refuse "the journal is not idle but says result=success, which a deploy never writes"
  if [[ "${journal_values[result]}" == verified || "${journal_values[phase]}" == draining ]]; then verified=1; fi
  if ((verified)); then final_result=success
  elif [[ "${journal_values[result]}" == failed:* ]]; then final_result="${journal_values[result]}"
  else final_result="failed:${journal_values[phase]}"; fi

  preflight_runtime
  ensure_state_subdirs existing
  if read_active_slot; then current_route="$ACTIVE_SLOT"; fi

  # The candidate record an abandoned deploy must end with.
  record_file="$slots_dir/$candidate_slot.env"
  if ((verified == 0)) && [[ "$records_state" == replaced ]]; then
    if read_slot_record "$candidate_slot" .prev; then
      recover_record_action=restore
      recover_record_content="$(slot_record_content "$SLOT_IMAGE" "$SLOT_COMMIT" "$SLOT_SNAPSHOT")"
    else
      recover_record_action=remove
    fi
    if read_slot_record "$candidate_slot"; then
      current_content="$(slot_record_content "$SLOT_IMAGE" "$SLOT_COMMIT" "$SLOT_SNAPSHOT")"
      [[ "$SLOT_COMMIT" == "$APP_COMMIT" || "$current_content" == "$recover_record_content" ]] \
        || recover_refuse "the $candidate_slot slot record matches neither the journal's manifest commit nor $candidate_slot.env.prev"
    fi
  fi

  if ((verified)); then recover_target="$candidate_slot"; recover_commit="$APP_COMMIT"
  elif [[ -n "$prior_slot" ]]; then recover_target="$prior_slot"; recover_commit="$prior_commit"; fi

  if [[ -n "$recover_target" ]]; then
    read_slot_record "$recover_target" || recover_refuse "app-$recover_target must serve but has no slot record"
    [[ "$SLOT_COMMIT" == "$recover_commit" ]] \
      || recover_refuse "the $recover_target slot record names commit $SLOT_COMMIT but the journal expects $recover_commit"
    target_image="$SLOT_IMAGE"; snapshot="$state_dir/$SLOT_SNAPSHOT"
    if ((verified)) && [[ -n "$prior_slot" ]]; then
      read_slot_record "$prior_slot" && [[ "$SLOT_COMMIT" == "$prior_commit" ]] \
        || recover_refuse "the $prior_slot slot record does not match the journal's prior commit $prior_commit"
    fi
    [[ -e "$snapshot" || -L "$snapshot" ]] || recover_refuse "the runtime snapshot ${snapshot##*/} recorded for app-$recover_target is missing"
    file_metadata "$snapshot" 600 'runtime snapshot'
    [[ "$(sha256sum "$snapshot" | awk '{print $1}')" == "$(basename -- "$snapshot" .snapshot.env)" ]] \
      || recover_refuse "the runtime snapshot ${snapshot##*/} recorded for app-$recover_target drifted"
    hash="$(snapshot_hash)" || recover_refuse 'cannot hash the runtime configuration'
    [[ "$hash.snapshot.env" == "${snapshot##*/}" ]] \
      || recover_refuse "the runtime configuration differs from the snapshot ${snapshot##*/} recorded for app-$recover_target; restore the runtime file matching the recorded snapshot (rotate configuration separately)"
    APP_SNAPSHOT="$snapshot"
    validate_image "$target_image"
    other="$(other_slot "$recover_target")"
  else
    # Unverified bootstrap: no release was ever recorded before this deploy.
    [[ ! -e "$slots_dir/$(other_slot "$candidate_slot").env" ]] \
      || recover_refuse "the journal describes a bootstrap but app-$(other_slot "$candidate_slot") has a slot record"
    [[ "$records_state" == replaced || ! -e "$record_file" ]] \
      || recover_refuse "the journal says records=untouched for a bootstrap but app-$candidate_slot has a slot record"
    # Only stop runs, so Compose just needs a readable snapshot: the
    # candidate's recorded one, else its .prev's, else a protected temporary
    # rendering (prepare, the remedy for a missing one, refuses this journal).
    for slot in '' .prev; do
      if [[ -e "$record_file$slot" ]] && read_slot_record "$candidate_slot" "$slot" && snapshot_valid "$state_dir/$SLOT_SNAPSHOT"; then
        APP_SNAPSHOT="$state_dir/$SLOT_SNAPSHOT"; break
      fi
    done
    if [[ -z "$APP_SNAPSHOT" ]]; then
      trap recover_cleanup EXIT
      recover_tmp="$(mktemp -d)" || recover_refuse 'could not allocate a temporary snapshot directory'
      chmod 0700 "$recover_tmp" || recover_refuse 'could not protect the temporary snapshot directory'
      (umask 077; snapshot_content > "$recover_tmp/app.snapshot.env") || recover_refuse 'could not render a temporary snapshot'
      APP_SNAPSHOT="$recover_tmp/app.snapshot.env"
    fi
  fi

  # Compose interpolates both slot images; only the target is ever started.
  # A slot without a record borrows the target image, or for a bootstrap the
  # locked Caddy image, purely for interpolation (it is only ever stopped).
  fallback="${target_image:-${locked[CADDY_IMAGE]}}"
  for slot in blue green; do
    if [[ "$slot" == "$recover_target" ]]; then image="$target_image"
    elif read_slot_record "$slot"; then image="$SLOT_IMAGE"
    else image="$fallback"; fi
    if [[ "$slot" == blue ]]; then APP_BLUE_IMAGE="$image"; else APP_GREEN_IMAGE="$image"; fi
  done
  ROUTES_DIR="$routes_dir"

  printf 'recover plan for %s (phase=%s result=%s records=%s):\n' "$journal_file" "${journal_values[phase]}" "${journal_values[result]}" "$records_state"
  if [[ -n "$recover_target" ]]; then
    if ((verified)); then printf '  serve:   app-%s at %s (the candidate was verified at the edge)\n' "$recover_target" "$recover_commit"
    else printf '  serve:   app-%s at %s (the prior slot; candidate app-%s was never verified)\n' "$recover_target" "$recover_commit" "$candidate_slot"; fi
  else
    printf '  serve:   nothing (unverified bootstrap); Caddy stays stopped\n'
  fi
  if [[ -n "$recover_target" ]]; then
    printf '  start:   PostgreSQL if it is not running, then app-%s on its recorded image if it is not already running it\n' "$recover_target"
    if [[ "$current_route" == "$recover_target" ]]; then printf '  route:   keep the route to app-%s\n' "$recover_target"
    elif [[ -n "$current_route" ]]; then printf '  route:   write the route to app-%s (currently app-%s)\n' "$recover_target" "$current_route"
    else printf '  route:   write the route to app-%s (currently absent)\n' "$recover_target"; fi
    printf '  caddy:   reload (or start) Caddy and confirm X-Mawareeth-Slot %s and commit %s at https://%s\n' "$recover_target" "$recover_commit" "${runtime_values[DOMAIN]}"
    printf '  stop:    app-%s after the edge confirms\n' "$other"
  else
    printf '  stop:    Caddy (confirmed stopped), then app-%s\n' "$candidate_slot"
  fi
  case "$recover_record_action" in
    restore) printf '  records: restore %s.env from %s.env.prev\n' "$candidate_slot" "$candidate_slot" ;;
    remove) printf '  records: remove %s.env (the slot had no record before the deploy)\n' "$candidate_slot" ;;
    *) printf '  records: leave slot records unchanged\n' ;;
  esac
  printf '  journal: reset to idle with result=%s\n' "$final_result"
  if ((dry_run)); then
    say 'dry run: nothing changed'
    return 0
  fi

  open_recover_log
  trap recover_on_exit EXIT
  stage=recovering
  say "recovering the deploy journaled in $journal_file; diagnostics: $deploy_log"
  if [[ -z "$recover_target" ]]; then
    stop_service caddy || recover_failed "Caddy could not be stopped and may serve unverified app-$candidate_slot"
    caddy_status=0; caddy_running || caddy_status=$?
    ((caddy_status == 1)) || recover_failed "Caddy is not confirmed stopped and may serve unverified app-$candidate_slot"
    stop_service "app-$candidate_slot" || recover_failed "app-$candidate_slot could not be stopped"
    recover_records || recover_failed "the $candidate_slot slot records could not be restored"
  else
    # Records are restored last, so if recover fails midway they still
    # describe what runs and a rerun starts from the same state.
    local unchanged="slot records and app-$other were not changed"
    recover_postgres
    if ! running_image_matches "app-$recover_target" "$target_image"; then
      say "starting app-$recover_target on its recorded image"
      compose_bounded "$command_timeout" up -d --no-build --pull never --no-deps "app-$recover_target" >>"$deploy_log" 2>&1 \
        || recover_failed "app-$recover_target could not be started; the route, $unchanged"
      running_image_matches "app-$recover_target" "$target_image" \
        || recover_failed "app-$recover_target is not running its recorded image $target_image; the route, $unchanged"
    fi
    wait_until "$ready_timeout" recover_target_ready \
      || recover_failed "app-$recover_target did not become ready within ${ready_timeout}s; the route, $unchanged (no fallback to another slot)"
    wait_until "$ready_timeout" recover_target_identity \
      || recover_failed "app-$recover_target does not report release commit $recover_commit; the route, $unchanged"
    if [[ "$current_route" != "$recover_target" ]]; then
      atomic_write "$route_file" 0644 "$(route_content "$recover_target")" \
        || recover_failed "cannot write the persisted route (the previous route file is unchanged); $unchanged"
    fi
    apply_route || recover_failed "Caddy could not load the route to app-$recover_target (the route file now targets it); $unchanged"
    wait_until "$verify_timeout" recover_target_edge \
      || recover_failed "the edge does not confirm app-$recover_target at $recover_commit over verified TLS within ${verify_timeout}s (the route file targets it); $unchanged"
    stop_service "app-$other" \
      || recover_failed "app-$recover_target serves and is confirmed at the edge, but app-$other could not be stopped; slot records were not changed"
    recover_records \
      || recover_failed "app-$recover_target serves and app-$other is stopped, but the $candidate_slot slot records could not be restored"
  fi
  recover_journal_idle "$final_result" || recover_failed "recovery finished but $journal_file could not be reset to idle"
  stage=complete
  if [[ -n "$recover_target" ]]; then say "recovered: app-$recover_target serves $recover_commit; app-$other stopped; journal idle ($final_result)"
  else say "recovered: unverified bootstrap rolled back, Caddy and app-$candidate_slot stopped; journal idle ($final_result)"; fi
}

usage='usage: release.sh deploy [--allow-contract] | release.sh recover [--dry-run]'
case "${1:-}" in
  deploy)
    shift
    if [[ $# -eq 0 ]]; then deploy
    elif [[ $# -eq 1 && "$1" == --allow-contract ]]; then allow_contract=1; deploy
    else fail_with 2 "$usage"; fi ;;
  recover)
    shift
    if [[ $# -eq 0 ]]; then recover 0
    elif [[ $# -eq 1 && "$1" == --dry-run ]]; then recover 1
    else fail_with 2 "$usage"; fi ;;
  *) fail_with 2 "$usage" ;;
esac
