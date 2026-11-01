#!/usr/bin/env bash
# Production deploys dispatched from GitHub Actions
# (.github/workflows/deploy-production.yml). See "Deploying from GitHub
# Actions" in deploy/README.md.
#
#   sudo deploy/ci-deploy.sh install PUBLIC_KEY_FILE
#
# install runs as root from the production checkout (/srv/mawareeth), once and
# again whenever this file changes. It refuses before changing anything unless:
# the deploy/ tree is clean; sudo is 1.9.10 or later; sshd reads keys only from
# the default authorized_keys files; the origin remote names a GitHub owner/repo;
# and /etc/mawareeth/github-read.token is a root:root mode-0600 file holding one
# token. It then:
#   - creates (or repairs) the mawareeth-deploy system user: no password, shell
#     /bin/sh, a root-owned home, and no group but its own;
#   - installs two fixed copies of this file, root:root 0755: the forced-command
#     entry /usr/local/lib/mawareeth/mawareeth-deploy-entry and the root wrapper
#     /usr/local/sbin/mawareeth-deploy-release. Each copy carries its role, this
#     checkout's path and the GitHub repository in its baked settings block and
#     ignores the environment, so a checkout of another commit never changes
#     what runs as root; only a new install does;
#   - writes /etc/sudoers.d/91-mawareeth-deploy (checked with visudo -cf), which
#     lets only that user run only the wrapper with one 40-hex argument;
#   - installs PUBLIC_KEY_FILE as the user's single authorized key, with
#     from="100.64.0.0/10",restrict,command="<entry>", in a root-owned file.
#
# The entry reads only SSH_ORIGINAL_COMMAND. It accepts exactly one lowercase
# 40-hex commit SHA and runs `sudo -n /usr/local/sbin/mawareeth-deploy-release
# SHA`; anything else is refused before sudo.
#
# The wrapper, as root, in order: revalidates the SHA; takes a lock; opens a
# root-only log under deploy/runtime/logs/ and copies all output there; refuses
# local changes under deploy/; fetches origin master and requires the SHA to be
# on it; downloads the newest release-manifest-SHA artifact produced by a
# successful master "Publish Release Image" run of this repository; validates
# the manifest with that commit's release_manifest.py (read from Git) against
# APP_IMAGE_REPOSITORY, requires deployment_bundle.git_sha == SHA, and requires
# the manifest's ci.workflow_run_id to be a successful master Django CI push run
# of this repository for exactly the SHA (all before anything changes); checks
# out the SHA; pulls the image by digest and verifies its
# RepoDigests; installs the manifest; runs runtime.sh prepare; points the master
# branch at the SHA; runs release.sh deploy (a plain deploy: never a contract
# release, never recover). A failure or signal before release.sh deploy starts
# restores the previous checkout, branch and manifest. Once it has started, the
# wrapper waits for it whatever happens to the SSH channel. The token is never
# printed and never appears on a command line.
#
# Wrapper exit codes. Its own outcomes use 64-67 only: 64 refused (bad input, not
# on master, local changes, no valid artifact, API or token error, manifest
# rejected, digest mismatch), with the checkout and manifest as before; 65
# another CI deploy holds the lock; 66 CRITICAL: restoring the previous checkout
# or manifest failed; 67 a signal arrived before release.sh deploy started
# (restored). Every other nonzero code is passed through: from docker pull or
# runtime.sh prepare (restored; 124 means the time limit ran out), or from
# release.sh deploy (not restored: release.sh owns its rollback and its exit
# codes keep their meaning). The last line is always
# `ci-deploy: result=<stage>:<code>`.
set -Eeuo pipefail
umask 077

# >>> baked settings (install rewrites this block in the copies it installs)
ci_role=checkout
ci_checkout=''
ci_prefix=''
ci_path=''
ci_repo=''
ci_pull_timeout=1800
ci_prepare_timeout=900
# <<< baked settings

secure_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
sha_pattern='^[0-9a-f]{40}$'
deploy_user=mawareeth-deploy
api_url=https://api.github.com
publish_workflow_path=.github/workflows/deploy.yml
validation_workflow_path=.github/workflows/django.yml
stage=input

say() { printf 'ci-deploy: %s\n' "$*" >&2 2>/dev/null || true; }
die() { local code="$1"; shift; say "$*"; exit "$code"; }

if [[ "$ci_role" == checkout ]]; then
  # The checkout copy is the installer only. MAWAREETH_CI_PREFIX (a directory
  # prepended to every system path), MAWAREETH_CI_PATH and the two timeouts
  # exist for the offline tests; install writes their values into the copies.
  ci_checkout="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
  ci_prefix="${MAWAREETH_CI_PREFIX:-}"
  ci_path="${MAWAREETH_CI_PATH:-$secure_path}"
  ci_pull_timeout="${MAWAREETH_CI_PULL_TIMEOUT:-$ci_pull_timeout}"
  ci_prepare_timeout="${MAWAREETH_CI_PREPARE_TIMEOUT:-$ci_prepare_timeout}"
else
  PATH="$ci_path"
  export PATH
fi

wrapper_path="$ci_prefix/usr/local/sbin/mawareeth-deploy-release"
entry_path="$ci_prefix/usr/local/lib/mawareeth/mawareeth-deploy-entry"
sudoers_path="$ci_prefix/etc/sudoers.d/91-mawareeth-deploy"
deploy_home="$ci_prefix/var/lib/mawareeth-deploy"
token_file="$ci_prefix/etc/mawareeth/github-read.token"
manifest_file="$ci_prefix/etc/mawareeth/release-manifest.json"
runtime_file="$ci_prefix/etc/mawareeth/runtime.env"
lock_file="$ci_prefix/run/mawareeth-ci-deploy.lock"
state_dir="$ci_checkout/deploy/runtime"

require_command() { command -v "$1" >/dev/null 2>&1 || die 64 "required command is unavailable: $1"; }

# root_file PATH MODE: a regular non-symlink file owned by root:root with MODE.
root_file() {
  [[ -f "$1" && ! -L "$1" ]] || return 1
  [[ "$(stat -c '%u:%g:%a' -- "$1" 2>/dev/null)" == "0:0:$2" ]]
}

# read_token sets token from the token file; the value is never printed.
read_token() {
  root_file "$token_file" 600 || return 1
  token="$(< "$token_file")" || return 1
  [[ "$token" =~ ^[A-Za-z0-9_]{20,255}$ ]]
}

# strip_baked FILE prints FILE without its baked settings block.
strip_baked() { sed '/^# >>> baked settings/,/^# <<< baked settings/d' -- "$1"; }

# ---------------------------------------------------------------------------
# Forced-command entry (runs as mawareeth-deploy).

entry_main() {
  trap on_exit EXIT
  (($# == 0)) || die 64 'refused: the entry takes no arguments'
  local request="${SSH_ORIGINAL_COMMAND-}"
  [[ "$request" =~ $sha_pattern ]] || die 64 'refused: SSH_ORIGINAL_COMMAND must be exactly one 40-character lowercase commit SHA'
  exec sudo -n "$wrapper_path" "$request"
}

# ---------------------------------------------------------------------------
# Root wrapper.

token=''
repo_id=''
work=''
child=''
needs_restore=0
had_manifest=0
prev_head=''
prev_ref=''
prev_master=''

# install_manifest SOURCE publishes SOURCE as the manifest atomically, mode 0600.
install_manifest() {
  local temporary
  temporary="$(mktemp "${manifest_file%/*}/.release-manifest.XXXXXX")" || return 1
  if cat -- "$1" > "$temporary" && chmod 0600 "$temporary" && mv -f -- "$temporary" "$manifest_file"; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

# shellcheck disable=SC2329 # called from on_exit
restore() {
  local ok=1 g=(git -C "$ci_checkout")
  if "${g[@]}" -c advice.detachedHead=false checkout --quiet --detach "$prev_head" 8>&-; then
    if [[ -n "$prev_master" ]]; then
      "${g[@]}" update-ref refs/heads/master "$prev_master" 8>&- || ok=0
    elif "${g[@]}" show-ref --verify --quiet refs/heads/master 8>&-; then
      "${g[@]}" update-ref -d refs/heads/master 8>&- || ok=0
    fi
    [[ -z "$prev_ref" ]] || "${g[@]}" symbolic-ref HEAD "$prev_ref" 8>&- || ok=0
  else
    ok=0
  fi
  if ((had_manifest)); then
    install_manifest "$work/previous-manifest.json" || ok=0
  else
    rm -f -- "$manifest_file" || ok=0
  fi
  if ((ok)); then
    say "restored checkout ${prev_ref:-$prev_head} at $prev_head and the previous release manifest"
    return 0
  fi
  say "CRITICAL: could not restore checkout ${prev_ref:-$prev_head} at $prev_head and the previous release manifest at $manifest_file; restore both by hand before the next deploy"
  return 1
}

# shellcheck disable=SC2329 # the EXIT trap
on_exit() {
  local status=$?
  trap - EXIT
  if ((needs_restore)); then
    needs_restore=0
    restore || status=66
  fi
  [[ -z "$work" ]] || rm -rf -- "$work"
  say "result=$stage:$status"
  exit "$status"
}

# shellcheck disable=SC2329 # signal traps before release.sh deploy starts
on_signal() {
  trap '' HUP INT TERM
  say "interrupted by SIG$1 during $stage, before release.sh deploy started"
  if [[ -n "$child" ]]; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit 67
}

# run_bounded SECONDS COMMAND... runs COMMAND under a time limit, in the
# background so a signal interrupts the wait, without the lock descriptor.
run_bounded() {
  local limit="$1" status=0
  shift
  timeout --kill-after=30 "$limit" "$@" 8>&- &
  child=$!
  wait "$child" || status=$?
  child=''
  return "$status"
}

# api_get URL OUTPUT prints the HTTP status. The token reaches curl through a
# config on a pipe, never argv or the environment; curl never sends it to the
# redirect host.
api_get() {
  curl --config <(printf 'header = "Authorization: Bearer %s"\n' "$token") \
    --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --retry 3 --retry-connrefused --connect-timeout 20 --max-time 120 --max-filesize 1048576 \
    --header 'Accept: application/vnd.github+json' --header 'X-GitHub-Api-Version: 2022-11-28' \
    --write-out '%{http_code}' --output "$2" "$1" 8>&-
}

# api_fetch URL OUTPUT DESCRIPTION refuses (64) naming the step, and the token
# (never its value) on HTTP 401 or 403.
api_fetch() {
  local code status=0
  code="$(api_get "$1" "$2")" || status=$?
  ((status != 0)) || return 0
  if [[ "$code" == 401 || "$code" == 403 ]]; then
    die 64 "refused: $3 failed: the GitHub read token is invalid or expired (HTTP $code)"
  fi
  die 64 "refused: $3 through the GitHub API failed (curl exit $status, HTTP ${code:-none})"
}

# open_log creates the root-only log and copies all further output to it. tee
# ignores signals and a closed SSH channel, so the log stays complete.
open_log() {
  local dir
  for dir in "$state_dir" "$state_dir/logs"; do
    [[ -d "$dir" ]] || install -d -o root -g root -m 0700 "$dir" 8>&- || die 64 "cannot create $dir"
  done
  log_file="$state_dir/logs/ci-deploy-$(date -u +%Y%m%dT%H%M%SZ)-$$.log"
  (set -C; : > "$log_file") 2>/dev/null || die 64 "cannot create the log $log_file"
  chmod 0600 "$log_file" || die 64 "cannot protect the log $log_file"
  say "log: $log_file"
  exec > >(trap '' HUP INT TERM PIPE; exec tee --output-error=exit-nopipe -a -- "$log_file" 8>&-) 2>&1
  say "deploy of $1 requested; log: $log_file"
}

# run_matches RUN_JSON PATH EVENT [HEAD_SHA] succeeds when the workflow run is a
# successful master run of PATH for EVENT in this repository (not a fork) and,
# when HEAD_SHA is not empty, for exactly that commit.
run_matches() {
  python3 -I - "$1" "$2" "$3" "$4" "$repo_id" 8>&- <<'PY'
import json
import sys

path, event, head_sha, repo_id = sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        run = json.load(handle)
    ok = (
        run.get("path") == path and run.get("event") == event and run.get("conclusion") == "success"
        and run.get("head_branch") == "master" and (not head_sha or run.get("head_sha") == head_sha)
        and run.get("repository", {}).get("id") == repo_id
        and run.get("head_repository", {}).get("id") == repo_id
    )
except (OSError, ValueError, AttributeError, TypeError):
    ok = False
raise SystemExit(0 if ok else 1)
PY
}

release_main() {
  trap on_exit EXIT
  (($# == 1)) || die 64 'refused: expected exactly one commit SHA argument'
  local sha="$1"
  [[ "$sha" =~ $sha_pattern ]] || die 64 'refused: the argument is not a 40-character lowercase commit SHA'
  [[ ${EUID:-999} -eq 0 ]] || die 64 'refused: must run as root'
  exec < /dev/null
  trap '' PIPE
  local command
  for command in git curl docker python3 flock stat mktemp timeout tee install date cmp sed sort grep; do require_command "$command"; done
  [[ "$ci_repo" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || die 64 'refused: no GitHub repository is configured; re-run install'

  stage=lock
  exec 8>> "$lock_file" || die 64 "cannot open the CI deploy lock $lock_file"
  flock -n 8 || die 65 "another CI deploy holds the lock $lock_file"

  trap 'on_signal HUP' HUP
  trap 'on_signal INT' INT
  trap 'on_signal TERM' TERM
  open_log "$sha"
  work="$(mktemp -d)" || die 64 'could not create a temporary directory'

  stage=preflight
  local repository status
  root_file "$runtime_file" 600 || die 64 "refused: the runtime file $runtime_file must be a root:root mode-0600 file"
  repository="$(sed -n 's/^APP_IMAGE_REPOSITORY=//p' "$runtime_file")" || die 64 "refused: cannot read $runtime_file"
  [[ "$repository" =~ ^ghcr\.io/[a-z0-9]+([._-][a-z0-9]+)*/[a-z0-9]+([._-][a-z0-9]+)*$ ]] \
    || die 64 "refused: APP_IMAGE_REPOSITORY in $runtime_file is missing or not one canonical GHCR repository"

  local g=(git -C "$ci_checkout")
  prev_head="$("${g[@]}" rev-parse --verify --quiet HEAD 8>&-)" || die 64 "refused: $ci_checkout is not a Git checkout"
  prev_ref="$("${g[@]}" symbolic-ref --quiet HEAD 8>&-)" || prev_ref=''
  prev_master="$("${g[@]}" rev-parse --verify --quiet refs/heads/master 8>&-)" || prev_master=''
  # release.sh's own check (untracked files included), and no tracked change
  # anywhere else.
  status="$("${g[@]}" status --porcelain -- deploy 8>&-)" || die 64 "refused: git status failed in $ci_checkout"
  [[ -z "$status" ]] || die 64 "refused: $ci_checkout has local changes under deploy/ (git status --porcelain -- deploy)"
  status="$("${g[@]}" status --porcelain --untracked-files=no 8>&-)" || die 64 "refused: git status failed in $ci_checkout"
  [[ -z "$status" ]] || die 64 "refused: $ci_checkout has local changes to tracked files"

  stage=fetch
  say "fetching origin master into $ci_checkout"
  timeout 300 "${g[@]}" fetch --quiet --no-tags origin '+refs/heads/master:refs/remotes/origin/master' 8>&- \
    || die 64 'refused: git fetch of origin master failed'
  if ! "${g[@]}" cat-file -e "$sha^{commit}" 2>/dev/null 8>&- \
    || ! "${g[@]}" merge-base --is-ancestor "$sha" refs/remotes/origin/master 8>&-; then
    die 64 "refused: $sha is not on origin/master"
  fi

  stage=artifact
  read_token || die 64 "refused: the GitHub token file $token_file must be a root:root mode-0600 file holding one token"
  local artifact="release-manifest-$sha" candidates artifact_id='' run_id ignored=0
  say "looking up artifact $artifact in $ci_repo"
  api_fetch "$api_url/repos/$ci_repo" "$work/repository.json" "reading repository $ci_repo"
  repo_id="$(python3 -I -c 'import json, sys; value = json.load(open(sys.argv[1], encoding="utf-8"))["id"]; assert type(value) is int and value > 0; print(value)' \
    "$work/repository.json" 8>&-)" || die 64 "refused: the GitHub API returned no id for $ci_repo"
  api_fetch "$api_url/repos/$ci_repo/actions/artifacts?name=$artifact&per_page=100" "$work/artifacts.json" "listing artifact $artifact"
  # Candidates, newest first: unexpired, this name, and made by a master run of
  # this repository (not a fork). A workflow_run-triggered Publish run reports
  # the default branch head at trigger time as its head_sha, so the commit is
  # proved through the manifest's CI run below instead.
  candidates="$(python3 -I - "$work/artifacts.json" "$artifact" "$repo_id" 8>&- <<'PY'
import json
import sys

name, repo_id = sys.argv[2], int(sys.argv[3])
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        listing = json.load(handle)
    for item in listing.get("artifacts", []):
        if not isinstance(item, dict) or item.get("name") != name or item.get("expired") is not False:
            continue
        run = item.get("workflow_run")
        if not isinstance(run, dict):
            continue
        ok = (
            type(item.get("id")) is int and item["id"] > 0 and type(run.get("id")) is int and run["id"] > 0
            and run.get("head_branch") == "master"
            and run.get("repository_id") == repo_id and run.get("head_repository_id") == repo_id
        )
        print(f"{item['id']} {run['id']}" if ok else "ignored")
except (OSError, ValueError, AttributeError, TypeError):
    raise SystemExit(2)
PY
)" || die 64 "refused: the artifact listing for $artifact is unreadable"
  ignored="$(grep -c '^ignored$' <<< "$candidates" || true)"
  candidates="$(grep -v '^ignored$' <<< "$candidates" | sort -rn || true)"
  local line
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    run_id="${line#* }"
    # The run must be a successful master Publish Release Image (deploy.yml)
    # run of this repository.
    api_fetch "$api_url/repos/$ci_repo/actions/runs/$run_id" "$work/run.json" "reading workflow run $run_id"
    if run_matches "$work/run.json" "$publish_workflow_path" workflow_run ''; then
      artifact_id="${line%% *}"
      break
    fi
    ignored=$((ignored + 1))
  done <<< "$candidates"
  ((ignored == 0)) || say "ignored $ignored $artifact artifact(s) not produced by a successful master Publish Release Image run of $ci_repo"
  [[ -n "$artifact_id" ]] || die 64 "refused: no unexpired artifact $artifact from a successful master Publish Release Image run exists"
  say "downloading artifact $artifact (id $artifact_id, run $run_id)"
  api_fetch "$api_url/repos/$ci_repo/actions/artifacts/$artifact_id/zip" "$work/artifact.zip" "downloading artifact $artifact"
  python3 -I - "$work/artifact.zip" "$work/release-manifest.json" 8>&- <<'PY' || die 64 "refused: artifact $artifact is not a zip holding only release-manifest.json"
import sys
import zipfile
import zlib

try:
    with zipfile.ZipFile(sys.argv[1]) as archive:
        members = archive.infolist()
        if [member.filename for member in members] != ["release-manifest.json"] or members[0].file_size > 65536:
            raise SystemExit(1)
        data = archive.read(members[0])
    if len(data) > 65536:
        raise SystemExit(1)
except (OSError, EOFError, RuntimeError, NotImplementedError, ValueError, zlib.error, zipfile.BadZipFile, zipfile.LargeZipFile):
    raise SystemExit(1)
with open(sys.argv[2], "wb") as handle:
    handle.write(data)
PY

  # Validate before anything changes, with the release commit's own validator
  # (read from Git, not from a checkout).
  stage=validate
  mkdir -p "$work/validator" || die 64 'could not create a temporary directory'
  "${g[@]}" show "$sha:deploy/release_manifest.py" > "$work/validator/release_manifest.py" 8>&- \
    || die 64 "refused: $sha has no deploy/release_manifest.py"
  python3 -I "$work/validator/release_manifest.py" validate --input "$work/release-manifest.json" --expected-repository "$repository" 8>&- \
    || die 64 "refused: release_manifest.py validate --expected-repository $repository rejected the manifest"
  local image fields ci_run_id
  status=0
  fields="$(python3 -I - "$work/release-manifest.json" "$sha" 8>&- <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    manifest = json.load(handle)
if manifest["deployment_bundle"]["git_sha"] != sys.argv[2]:
    raise SystemExit(3)
ci = manifest.get("ci")
run_id = ci.get("workflow_run_id") if isinstance(ci, dict) else None
if not isinstance(run_id, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", run_id):
    raise SystemExit(4)
print(manifest["application"]["image"])
print(run_id)
PY
)" || status=$?
  ((status != 3)) || die 64 "refused: the manifest's deployment_bundle.git_sha is not $sha"
  ((status != 4)) || die 64 'refused: the manifest has no valid ci.workflow_run_id'
  ((status == 0)) || die 64 'refused: cannot read the validated manifest'
  image="${fields%%$'\n'*}"
  ci_run_id="${fields#*$'\n'}"
  [[ "${image%@*}" == "$repository" && "${image#*@}" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || die 64 "refused: the manifest image is not a $repository digest reference"
  # The manifest's CI run proves the commit: a successful master Django CI push
  # run of this repository for exactly this SHA.
  api_fetch "$api_url/repos/$ci_repo/actions/runs/$ci_run_id" "$work/ci-run.json" "reading the manifest's Django CI run $ci_run_id"
  run_matches "$work/ci-run.json" "$validation_workflow_path" push "$sha" \
    || die 64 "refused: the manifest's CI run $ci_run_id is not a successful master Django CI push run of $ci_repo for $sha"
  token=''

  # From here a failure or signal restores the previous checkout and manifest.
  stage=checkout
  if [[ -e "$manifest_file" || -L "$manifest_file" ]]; then
    root_file "$manifest_file" 600 || die 64 "refused: the installed release manifest $manifest_file must be a root:root mode-0600 file"
    cp -- "$manifest_file" "$work/previous-manifest.json" || die 64 "refused: cannot back up $manifest_file"
    had_manifest=1
  fi
  needs_restore=1
  say "checking out $sha (previous: ${prev_ref:-detached} at $prev_head)"
  "${g[@]}" -c advice.detachedHead=false checkout --quiet --detach "$sha" 8>&- || die 64 "refused: could not check out $sha"
  if ! cmp -s <(strip_baked "$wrapper_path") <(strip_baked "$ci_checkout/deploy/ci-deploy.sh"); then
    say "WARNING: deploy/ci-deploy.sh at $sha differs from the installed $wrapper_path; re-run 'sudo deploy/ci-deploy.sh install' with the deploy key after this deploy"
  fi

  stage=image
  say "pulling $image"
  status=0
  run_bounded "$ci_pull_timeout" docker pull --quiet "$image" || status=$?
  ((status == 0)) || die "$status" "docker pull of $image failed (exit $status; 124 means it exceeded ${ci_pull_timeout}s)"
  local digests
  digests="$(docker image inspect --format '{{join .RepoDigests "\n"}}' "$image" 8>&-)" || die 64 "refused: cannot inspect $image"
  grep -Fxq -- "$image" <<< "$digests" || die 64 "refused: the pulled image's RepoDigests do not contain $image"

  stage=manifest
  install_manifest "$work/release-manifest.json" || die 64 "refused: could not install the release manifest at $manifest_file"

  stage=prepare
  say 'running runtime.sh prepare'
  status=0
  MAWAREETH_RELEASE_MANIFEST="$manifest_file" run_bounded "$ci_prepare_timeout" "$ci_checkout/deploy/runtime.sh" prepare || status=$?
  ((status == 0)) || die "$status" "runtime.sh prepare failed (exit $status; 124 means it exceeded ${ci_prepare_timeout}s)"

  stage=deploy
  "${g[@]}" switch --quiet --force-create master "$sha" 8>&- || die 64 "refused: could not point master at $sha"
  # Ignore signals before clearing the restore, so no instant has neither.
  # release.sh owns its rollback from here; this process waits for its code.
  trap ':' HUP INT TERM
  needs_restore=0
  say "running release.sh deploy for $sha"
  status=0
  MAWAREETH_RELEASE_MANIFEST="$manifest_file" "$ci_checkout/deploy/release.sh" deploy 8>&- || status=$?
  if ((status == 0)); then say "deployed $sha"; else say "release.sh deploy failed (exit $status); see its exit codes in deploy/README.md"; fi
  exit "$status"
}

# ---------------------------------------------------------------------------
# Installer (checkout copy only).

# bake ROLE TARGET installs a copy of this file with its baked settings block.
bake() {
  local role="$1" target="$2" temporary block line
  block="ci_role=$role
ci_checkout='$ci_checkout'
ci_prefix='$ci_prefix'
ci_path='$ci_path'
ci_repo='$ci_repo'
ci_pull_timeout=$ci_pull_timeout
ci_prepare_timeout=$ci_prepare_timeout"
  temporary="$(mktemp "${target%/*}/.ci-deploy.XXXXXX")" || die 64 "cannot create a temporary file next to $target"
  if ! awk -v block="$block" '
      /^# >>> baked settings/ { print; print block; skip = 1; next }
      /^# <<< baked settings/ { skip = 0 }
      !skip' "$ci_checkout/deploy/ci-deploy.sh" > "$temporary"; then
    rm -f -- "$temporary"; die 64 "could not install $target"
  fi
  while IFS= read -r line; do
    grep -Fxq -- "$line" "$temporary" || { rm -f -- "$temporary"; die 64 "could not write the baked settings into $target"; }
  done <<< "$block"
  if ! cmp -s <(strip_baked "$temporary") <(strip_baked "$ci_checkout/deploy/ci-deploy.sh") \
    || ! chown root:root "$temporary" || ! chmod 0755 "$temporary" || ! mv -f -- "$temporary" "$target"; then
    rm -f -- "$temporary"
    die 64 "could not install $target"
  fi
}

# publish TARGET MODE CONTENT [CHECK] writes CONTENT atomically, root-owned.
publish() {
  local target="$1" mode="$2" content="$3" check="${4:-}" temporary
  temporary="$(mktemp "${target%/*}/.mawareeth-deploy.XXXXXX")" || die 64 "cannot create a temporary file next to $target"
  if ! printf '%s\n' "$content" > "$temporary" || ! chown root:root "$temporary" || ! chmod "$mode" "$temporary" \
    || { [[ -n "$check" ]] && ! "$check" "$temporary"; } || ! mv -f -- "$temporary" "$target"; then
    rm -f -- "$temporary"
    die 64 "could not install $target"
  fi
}

# shellcheck disable=SC2329 # called through publish
check_sudoers() { visudo -cf "$1" >/dev/null; }

# github_repository prints owner/repo from the origin remote's configured URL.
github_repository() {
  local url
  url="$(git -C "$ci_checkout" config --get remote.origin.url)" || return 1
  url="${url%.git}"
  case "$url" in
    https://github.com/*) url="${url#https://github.com/}" ;;
    git@github.com:*) url="${url#git@github.com:}" ;;
    ssh://git@github.com/*) url="${url#ssh://git@github.com/}" ;;
    *) return 1 ;;
  esac
  [[ "$url" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || return 1
  printf '%s\n' "$url"
}

install_main() {
  (($# == 1)) || die 64 'usage: sudo deploy/ci-deploy.sh install PUBLIC_KEY_FILE'
  [[ ${EUID:-999} -eq 0 ]] || die 64 'install must run as root'
  local command
  for command in git useradd usermod id visudo sudo sshd install chown chmod mktemp sed awk grep stat cmp; do require_command "$command"; done
  [[ "$ci_checkout$ci_prefix" =~ ^[A-Za-z0-9._/-]+$ && "$ci_checkout" == /* ]] || die 64 'the checkout and prefix paths may contain only A-Z a-z 0-9 . _ / -'
  [[ -z "$ci_prefix" || "$ci_prefix" == /* ]] || die 64 'MAWAREETH_CI_PREFIX must be absolute'
  [[ "$ci_path" =~ ^/[A-Za-z0-9._/:-]+$ ]] || die 64 'MAWAREETH_CI_PATH may contain only A-Z a-z 0-9 . _ / : -'
  [[ "$ci_pull_timeout" =~ ^[1-9][0-9]{0,4}$ && "$ci_prepare_timeout" =~ ^[1-9][0-9]{0,4}$ ]] || die 64 'the timeouts must be 1-99999 seconds'
  local script
  for script in ci-deploy.sh runtime.sh release.sh release_manifest.py; do
    [[ -f "$ci_checkout/deploy/$script" ]] || die 64 "$ci_checkout is not a deployment checkout (deploy/$script is missing)"
  done
  local dirty
  dirty="$(git -C "$ci_checkout" status --porcelain -- deploy)" || die 64 "git status failed in $ci_checkout"
  [[ -z "$dirty" ]] || die 64 "$ci_checkout has local changes under deploy/; install only from a clean checkout"
  ci_repo="$(github_repository)" || die 64 "the origin remote of $ci_checkout is not a github.com owner/repo URL"

  local version
  version="$(sudo -V 2>/dev/null | sed -n '1s/^Sudo version \([0-9]*\.[0-9]*\.[0-9]*\).*$/\1/p')"
  [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die 64 'cannot read the sudo version (sudo -V)'
  if ((BASH_REMATCH[1] < 1 || (BASH_REMATCH[1] == 1 && (BASH_REMATCH[2] < 9 || (BASH_REMATCH[2] == 9 && BASH_REMATCH[3] < 10))))); then
    die 64 "sudo $version is too old: the sudoers argument regex needs 1.9.10 or later"
  fi

  local sshd_config files keys_command
  sshd_config="$(sshd -T -C "user=$deploy_user,host=localhost,addr=100.64.0.1" 2>/dev/null)" || die 64 'sshd -T failed; cannot confirm where sshd reads authorized keys'
  files="$(sed -n 's/^authorizedkeysfile //p' <<< "$sshd_config")"
  keys_command="$(sed -n 's/^authorizedkeyscommand //p' <<< "$sshd_config")"
  [[ "$files" == '.ssh/authorized_keys .ssh/authorized_keys2' || "$files" == .ssh/authorized_keys ]] \
    || die 64 "sshd reads authorized keys from '$files'; only the default .ssh/authorized_keys is supported"
  [[ -z "$keys_command" || "$keys_command" == none ]] || die 64 'sshd uses an AuthorizedKeysCommand; it is not supported'

  local key
  [[ -f "$1" && ! -L "$1" ]] || die 64 "public key file $1 must be a regular file"
  key="$(tr -d '\r' < "$1")" || die 64 "cannot read public key file $1"
  [[ "$key" =~ ^(ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|ssh-rsa)\ [A-Za-z0-9+/]+={0,3}(\ [A-Za-z0-9@._+-]+)?$ ]] \
    || die 64 "public key file $1 must hold exactly one OpenSSH public key line, without options"

  read_token || die 64 "create $token_file first: root:root mode 0600, holding one fine-grained token with Actions read access to $ci_repo only"
  token=''

  if id -u "$deploy_user" >/dev/null 2>&1; then
    local groups
    groups="$(id -Gn "$deploy_user")" || die 64 "cannot read the groups of $deploy_user"
    [[ "$groups" == "$deploy_user" ]] || die 64 "$deploy_user belongs to other groups ($groups); remove them first"
  else
    useradd --system --user-group --no-create-home --home-dir "$deploy_home" --shell /bin/sh "$deploy_user" \
      || die 64 "could not create user $deploy_user"
  fi
  # Repairs an existing account too. No usable password: '*' rather than a '!'
  # lock, which sshd treats as a locked account when PAM is off.
  usermod --home "$deploy_home" --shell /bin/sh --password '*' "$deploy_user" || die 64 "could not configure $deploy_user"

  install -d -o root -g root -m 0755 "$deploy_home" "$deploy_home/.ssh" "${entry_path%/*}" "${wrapper_path%/*}" \
    || die 64 'could not create the deploy directories'
  rm -f -- "$deploy_home/.ssh/authorized_keys2" || die 64 "could not remove $deploy_home/.ssh/authorized_keys2"
  bake release "$wrapper_path"
  bake entry "$entry_path"
  publish "$sudoers_path" 0440 "$deploy_user ALL=(root) NOPASSWD: $wrapper_path ^[0-9a-f]{40}\$" check_sudoers
  publish "$deploy_home/.ssh/authorized_keys" 0644 "from=\"100.64.0.0/10\",restrict,command=\"$entry_path\" $key"
  say "installed for $ci_repo: $deploy_user may run only $entry_path from the tailnet, which runs only $wrapper_path SHA"
}

case "$ci_role" in
  entry) entry_main "$@" ;;
  release) release_main "$@" ;;
  checkout)
    case "${1:-}" in
      install) shift; install_main "$@" ;;
      *) die 64 'usage: sudo deploy/ci-deploy.sh install PUBLIC_KEY_FILE' ;;
    esac ;;
  *) die 64 'unknown role' ;;
esac
exit 0
