#!/usr/bin/env bash
# shellcheck disable=SC2016 # literal $ patterns are intentional in assertions.
# Offline tests for deploy/ci-deploy.sh: the installer, the forced-command entry
# and the root wrapper. Git runs for real against a local bare "origin"; curl,
# docker, sudo, sshd and the account tools are stubbed, as are runtime.sh and
# release.sh inside a disposable fixture checkout. Nothing touches the network,
# Docker, sudoers, accounts or this checkout.
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$root/deploy/ci-deploy.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; [[ ! -f "${tmp:-}/out" ]] || sed 's/^/  | /' "$tmp/out" >&2; exit 1; }

bash -n "$script" "$0"
# Static guards: the wrapper never deploys a contract release or recovers, never
# pulls by tag, never builds, and keeps the lock out of its children.
! grep -Eq -- '--allow-contract|release\.sh"? recover' "$script" || fail 'ci-deploy.sh must never pass --allow-contract or run recover'
{ [[ "$(grep -Ec '^[[:space:]]*(run_bounded "\$ci_pull_timeout" )?docker pull' "$script")" == 1 ]] \
  && grep -Fq 'run_bounded "$ci_pull_timeout" docker pull --quiet "$image"' "$script"; } || fail 'the only pull must be the bounded pull of the manifest digest reference'
! grep -Eq 'docker (build|buildx|compose build)' "$script" || fail 'ci-deploy.sh must never build'
grep -Fq 'exec sudo -n "$wrapper_path" "$request"' "$script" || fail 'the entry must run only sudo -n on the wrapper'
grep -Fq '"$ci_checkout/deploy/release.sh" deploy 8>&-' "$script" || fail 'release.sh must run without the lock descriptor'
command -v flock >/dev/null 2>&1 || fail 'flock(1) is required'

real_stat="$(command -v stat)"; real_install="$(command -v install)"
tmp="$(mktemp -d)"; [[ -z "${KEEP_TMP:-}" ]] || echo "$tmp" >&2
case "$tmp" in "$root"/*) fail 'temporary directory must be outside the checkout' ;; esac
trap '[[ -n "${KEEP_TMP:-}" ]] || rm -rf "$tmp"' EXIT
stub="$tmp/bin"; S="$tmp/state"; prefix="$tmp/host"; origin="$tmp/origin.git"; checkout="$tmp/srv/mawareeth"
mkdir -p "$stub" "$S" "$prefix/etc/mawareeth" "$prefix/etc/sudoers.d" "$prefix/run" "$tmp/src/deploy"
export CI_TEST_STATE="$S"
token='github_pat_TESTTOKENvalue0123456789abcdefSECRET'
github_url=https://github.com/example/mawareeth.git

# --- Fixture repository: master has commits a and b (b changes ci-deploy.sh);
# side has c (not on master).
cp "$root/deploy/release_manifest.py" "$tmp/src/deploy/"
printf 'deploy/runtime/\n' > "$tmp/src/.gitignore"
if [[ ${EUID:-999} -ne 0 ]]; then
  sed 's/\[\[ ${EUID:-999} -eq 0 \]\]/[[ 0 -eq 0 ]]/' "$script" > "$tmp/src/deploy/ci-deploy.sh"
  [[ "$(grep -c '\[\[ 0 -eq 0 \]\]' "$tmp/src/deploy/ci-deploy.sh")" == 2 ]] || fail 'root-gate patch was not applied'
else
  cp "$script" "$tmp/src/deploy/ci-deploy.sh"
fi
# The stubs record their arguments, the manifest, the checkout, and whether they
# inherited the lock descriptor; markers make them sleep, fail, or break the
# restore that follows.
for name in runtime.sh release.sh; do
  cat > "$tmp/src/deploy/$name" <<'EOF'
#!/usr/bin/env bash
name="${0##*/}" S="$CI_TEST_STATE" checkout="$(cd -- "$(dirname -- "$0")/.." && pwd)"
fd8=closed; [[ ! -e "/proc/$$/fd/8" ]] || fd8=open
printf '%s %s manifest=%s head=%s fd8=%s\n' "$name" "$*" "${MAWAREETH_RELEASE_MANIFEST:-}" \
  "$(git -C "$checkout" rev-parse HEAD)" "$fd8" >> "$S/calls"
if [[ -e "$S/sleep-$name" ]]; then touch "$S/started-$name"; sleep "$(< "$S/sleep-$name")"; fi
printf '%s output\n' "$name"
[[ ! -e "$S/break-restore" ]] || touch "$checkout/.git/index.lock"
[[ ! -e "$S/exit-$name" ]] || exit "$(< "$S/exit-$name")"
EOF
done
chmod 0755 "$tmp/src/deploy/"*.sh
g() { git -c user.name=test -c user.email=test@example.invalid -c core.autocrlf=false -c commit.gpgsign=false -c init.defaultBranch=master "$@"; }
g init -q "$tmp/src"
g -C "$tmp/src" add -A
g -C "$tmp/src" commit -q -m a
sha_a="$(g -C "$tmp/src" rev-parse HEAD)"
printf '# changed in release b\n' >> "$tmp/src/deploy/ci-deploy.sh"
g -C "$tmp/src" commit -q -am b
sha_b="$(g -C "$tmp/src" rev-parse HEAD)"
g -C "$tmp/src" checkout -q -b side "$sha_a"
g -C "$tmp/src" commit -q --allow-empty -m c
sha_c="$(g -C "$tmp/src" rev-parse HEAD)"
g init -q --bare "$origin"
g -C "$tmp/src" push -q "$origin" "$sha_b:refs/heads/master" side
mkdir -p "${checkout%/*}"
g clone -q "$origin" "$checkout"
# The configured origin is the GitHub URL; fetches resolve to the local bare repo.
g -C "$checkout" remote set-url origin "$github_url"
g -C "$checkout" config "url.$origin.insteadOf" "$github_url"
g -C "$checkout" checkout -q -f -B master "$sha_a"
unknown_sha=0123456789abcdef0123456789abcdef01234567

digest() { printf 'sha256:%s' "$(printf '%064d' 0 | tr 0 "$1")"; }
digest_a="$(digest a)"; digest_b="$(digest b)"; digest_b2="$(digest d)"
# Each release's manifest names its Django CI run: 8 for a, 7 otherwise.
ci_id() { if [[ "$1" == "$sha_a" ]]; then echo 8; else echo 7; fi; }
manifest_json() { # SHA DIGEST [REPOSITORY] [CI_RUN_ID]
  printf '{"manifest_version":1,"release":{"version":"%s","commit_sha":"%s"},"application":{"image":"%s@%s","digest":"%s"},"deployment_bundle":{"git_sha":"%s"},"configuration":{"schema_version":"1"},"database":{"migration_contract":"expand-migrate-contract-v1"},"ci":{"workflow":"Django CI","workflow_run_id":"%s"}}\n' \
    "$1" "$1" "${3:-ghcr.io/example/mawareeth}" "$2" "$2" "$1" "${4:-$(ci_id "$1")}"
}
# ci_run ID SHA [key=value...] writes a Django CI run. Keys: path, event,
# branch, conclusion, head_repo.
ci_run() {
  local id="$1" sha="$2" option
  shift 2
  local path=.github/workflows/django.yml event=push branch=master conclusion=success head_repo=1000
  for option in "$@"; do local "${option?}"; done
  printf '{"id":%s,"name":"Django CI","path":"%s","event":"%s","conclusion":"%s","head_sha":"%s","head_branch":"%s","repository":{"id":1000},"head_repository":{"id":%s}}\n' \
    "$id" "$path" "$event" "$conclusion" "$sha" "$branch" "$head_repo" > "$S/run-$id"
}
# add_artifact SHA ID CONTENT [key=value...] adds one artifact to the listing,
# its zip, and its workflow run (id ID+1000). Keys: branch, head_repo,
# run_head_repo, path, event, conclusion, run_sha, expired, members
# (comma-separated).
add_artifact() {
  local sha="$1" id="$2" content="$3" option
  shift 3
  local branch=master head_repo=1000 path=.github/workflows/deploy.yml event=workflow_run conclusion=success run_sha="$sha" expired=false
  local members=release-manifest.json run_head_repo=''
  for option in "$@"; do local "${option?}"; done
  [[ -n "$run_head_repo" ]] || run_head_repo="$head_repo"
  printf '%s' "$content" > "$tmp/member"
  python3 - "$S/zip-$id" "$tmp/member" "$members" <<'PY'
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1], "w") as archive:
    for name in sys.argv[3].split(","):
        archive.write(sys.argv[2], name)
PY
  printf '{"id":%s,"name":"release-manifest-%s","expired":%s,"workflow_run":{"id":%s,"repository_id":1000,"head_repository_id":%s,"head_branch":"%s","head_sha":"%s"}}\n' \
    "$id" "$sha" "$expired" "$((id + 1000))" "$head_repo" "$branch" "$run_sha" >> "$S/items-$sha"
  printf '{"id":%s,"path":"%s","event":"%s","conclusion":"%s","head_sha":"%s","head_branch":"%s","repository":{"id":1000},"head_repository":{"id":%s}}\n' \
    "$((id + 1000))" "$path" "$event" "$conclusion" "$run_sha" "$branch" "$run_head_repo" > "$S/run-$((id + 1000))"
}

# --- Stubs.
cat > "$stub/curl" <<'EOF'
#!/usr/bin/env bash
S="$CI_TEST_STATE"
printf 'curl %s\n' "$*" >> "$S/curl.argv"
config='' output='' url="${*: -1}" write=''
while (($#)); do
  case "$1" in
    --config) config="$2"; shift ;;
    --output) output="$2"; shift ;;
    --write-out) write="$2"; shift ;;
  esac
  shift
done
[[ "$write" == '%{http_code}' ]] || exit 2
answer() { printf '%s' "$1"; ((${1} < 400)) || { echo "curl: (22) The requested URL returned error: $1" >&2; exit 22; }; }
[[ -n "$config" ]] && grep -Fxq "header = \"Authorization: Bearer $(< "$S/token")\"" "$config" || answer 401
base=https://api.github.com/repos/example/mawareeth
case "$url" in
  "$base") [[ ! -e "$S/fail-repo" ]] || answer 404; printf '{"id":1000,"full_name":"Example/Mawareeth"}' > "$output" ;;
  "$base/actions/artifacts?name=release-manifest-"*"&per_page=100")
    [[ ! -e "$S/fail-list" ]] || answer 500
    sha="${url##*release-manifest-}"; sha="${sha%%&*}"
    items=''; [[ ! -e "$S/items-$sha" ]] || items="$(paste -sd, "$S/items-$sha")"
    printf '{"total_count":0,"artifacts":[%s]}' "$items" > "$output" ;;
  "$base/actions/runs/"*)
    [[ -e "$S/run-${url##*/}" ]] || answer 404
    cp "$S/run-${url##*/}" "$output" ;;
  "$base/actions/artifacts/"*/zip)
    [[ ! -e "$S/fail-download" ]] || answer 410
    id="${url%/zip}"; id="${id##*/}"
    cp "$S/zip-$id" "$output" ;;
  *) echo "curl: unexpected URL $url" >&2; exit 3 ;;
esac
answer 200
EOF
cat > "$stub/docker" <<'EOF'
#!/usr/bin/env bash
S="$CI_TEST_STATE"
printf 'docker %s\n' "$*" >> "$S/docker.log"
case "$1" in
  pull) [[ ! -e "$S/exit-pull" ]] || exit "$(< "$S/exit-pull")" ;;
  image) if [[ -e "$S/repo-digests" ]]; then cat "$S/repo-digests"; else printf 'ghcr.io/example/other@sha256:%064d\n%s\n' 0 "${*: -1}"; fi ;;
  *) exit 1 ;;
esac
EOF
cat > "$stub/sudo" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == -V ]]; then
  printf 'Sudo version %s\nSudoers policy plugin version 1.9.15p5\n' "$(cat "$CI_TEST_STATE/sudo-version" 2>/dev/null || echo 1.9.15p5)"
  exit 0
fi
printf 'sudo %s\n' "$*" >> "$CI_TEST_STATE/sudo.log"
[[ "$1" == -n ]] || exit 1
shift
exec "$@"
EOF
cat > "$stub/sshd" <<'EOF'
#!/usr/bin/env bash
printf 'sshd %s\n' "$*" >> "$CI_TEST_STATE/accounts.log"
[[ "$1 $2" == '-T -C' ]] || exit 1
if [[ -e "$CI_TEST_STATE/sshd-T" ]]; then cat "$CI_TEST_STATE/sshd-T"
else printf 'port 22\nauthorizedkeysfile .ssh/authorized_keys .ssh/authorized_keys2\nauthorizedkeyscommand none\n'; fi
EOF
cat > "$stub/id" <<EOF
#!/usr/bin/env bash
if [[ "\$*" == '-u mawareeth-deploy' ]]; then [[ -e "\$CI_TEST_STATE/user-exists" ]] || exit 1; echo 999; exit 0; fi
if [[ "\$*" == '-Gn mawareeth-deploy' ]]; then cat "\$CI_TEST_STATE/groups" 2>/dev/null || echo mawareeth-deploy; exit 0; fi
exec $(command -v id) "\$@"
EOF
cat > "$stub/useradd" <<'EOF'
#!/usr/bin/env bash
printf 'useradd %s\n' "$*" >> "$CI_TEST_STATE/accounts.log"; touch "$CI_TEST_STATE/user-exists"
EOF
cat > "$stub/usermod" <<'EOF'
#!/usr/bin/env bash
printf 'usermod %s\n' "$*" >> "$CI_TEST_STATE/accounts.log"
EOF
cat > "$stub/visudo" <<'EOF'
#!/usr/bin/env bash
printf 'visudo %s\n' "$*" >> "$CI_TEST_STATE/accounts.log"
[[ "$1" == -cf && ! -e "$CI_TEST_STATE/fail-visudo" ]] && rm -f "$CI_TEST_STATE/visudo-checked" && cp "$2" "$CI_TEST_STATE/visudo-checked"
EOF
if [[ ${EUID:-999} -ne 0 ]]; then
  # Unprivileged: report every file as root-owned and drop ownership changes.
  printf '#!/usr/bin/env bash\n%q "$@" | sed -E "s/^[0-9]+:[0-9]+:/0:0:/"\n' "$real_stat" > "$stub/stat"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$stub/chown"
  cat > "$stub/install" <<EOF
#!/usr/bin/env bash
args=()
while ((\$#)); do case "\$1" in -o|-g) shift 2 ;; *) args+=("\$1"); shift ;; esac; done
exec $real_install "\${args[@]}"
EOF
fi
chmod 0755 "$stub"/*
printf '%s\n' "$token" > "$S/token"
export PATH="$stub:$PATH"
export MAWAREETH_CI_PREFIX="$prefix" MAWAREETH_CI_PATH="$stub:$PATH" MAWAREETH_CI_PREPARE_TIMEOUT=60 MAWAREETH_CI_PULL_TIMEOUT=60

wrapper="$prefix/usr/local/sbin/mawareeth-deploy-release"
entry="$prefix/usr/local/lib/mawareeth/mawareeth-deploy-entry"
manifest="$prefix/etc/mawareeth/release-manifest.json"
token_file="$prefix/etc/mawareeth/github-read.token"
logs="$checkout/deploy/runtime/logs"
printf '%s\n' "$token" > "$token_file"; chmod 0600 "$token_file"
printf 'DOMAIN=example.com\nAPP_IMAGE_REPOSITORY=ghcr.io/example/mawareeth\n' > "$prefix/etc/mawareeth/runtime.env"
chmod 0600 "$prefix/etc/mawareeth/runtime.env"
printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeployKeyForTests0123456789abcdefABCDEF ci-deploy@github\n' > "$tmp/key.pub"

# run EXPECTED COMMAND...: runs with output in $tmp/out and checks the exit code.
run() {
  local expected="$1" status=0; shift
  "$@" > "$tmp/out" 2>&1 || status=$?
  [[ "$status" == "$expected" ]] || fail "expected exit $expected, got $status: $*"
}
out_has() { grep -Fq -- "$1" "$tmp/out" || fail "output lacks: $1"; }
out_lacks() { ! grep -Fq -- "$1" "$tmp/out" || fail "output has: $1"; }
result_is() { [[ "$(tail -n 1 "$tmp/out")" == "ci-deploy: result=$1" ]] || fail "last line is not result=$1"; }
wait_for() { local _; for _ in $(seq 100); do [[ ! -e "$1" ]] || return 0; sleep 0.1; done; fail "timed out waiting for $1"; }

# --- install --------------------------------------------------------------
installer="$checkout/deploy/ci-deploy.sh"
installed() { [[ -e "$wrapper" || -e "$entry" ]] || grep -qv '^sshd ' "$S/accounts.log" 2>/dev/null; }
run 64 bash "$installer"
run 64 bash "$installer" install
printf 'ssh-ed25519 AAAA one\nssh-ed25519 AAAA two\n' > "$tmp/two.pub"
run 64 bash "$installer" install "$tmp/two.pub"; out_has 'exactly one OpenSSH public key line'
printf 'command="/bin/sh" ssh-ed25519 AAAAC3Nza\n' > "$tmp/opts.pub"
run 64 bash "$installer" install "$tmp/opts.pub"
chmod 0644 "$token_file"
run 64 bash "$installer" install "$tmp/key.pub"; out_has "create $token_file first"
chmod 0600 "$token_file"
printf 'not a token\n' > "$token_file"
run 64 bash "$installer" install "$tmp/key.pub"; out_has "create $token_file first"
printf '%s\n' "$token" > "$token_file"
printf '1.9.9\n' > "$S/sudo-version"
run 64 bash "$installer" install "$tmp/key.pub"; out_has 'sudo 1.9.9 is too old'
printf '1.8.31\n' > "$S/sudo-version"
run 64 bash "$installer" install "$tmp/key.pub"; out_has 'sudo 1.8.31 is too old'
rm -f "$S/sudo-version"
printf 'authorizedkeysfile /etc/ssh/keys/%%u\nauthorizedkeyscommand none\n' > "$S/sshd-T"
run 64 bash "$installer" install "$tmp/key.pub"; out_has "sshd reads authorized keys from '/etc/ssh/keys/%u'"
printf 'authorizedkeysfile .ssh/authorized_keys\nauthorizedkeyscommand /usr/bin/keys\n' > "$S/sshd-T"
run 64 bash "$installer" install "$tmp/key.pub"; out_has 'AuthorizedKeysCommand'
rm -f "$S/sshd-T"
printf 'x\n' > "$checkout/deploy/untracked"
run 64 bash "$installer" install "$tmp/key.pub"; out_has 'local changes under deploy/'
rm -f "$checkout/deploy/untracked"
g -C "$checkout" remote set-url origin /srv/elsewhere.git
run 64 bash "$installer" install "$tmp/key.pub"; out_has 'not a github.com owner/repo URL'
g -C "$checkout" remote set-url origin "$github_url"
! installed || fail 'a refused install changed something'
touch "$S/fail-visudo"
run 64 bash "$installer" install "$tmp/key.pub"; out_has 'could not install'
[[ ! -e "$prefix/etc/sudoers.d/91-mawareeth-deploy" ]] || fail 'a sudoers file that failed visudo was installed'
rm -f "$S/fail-visudo"
mkdir -p "$prefix/var/lib/mawareeth-deploy/.ssh"
printf 'ssh-ed25519 AAAA stray\n' > "$prefix/var/lib/mawareeth-deploy/.ssh/authorized_keys2"
run 0 bash "$installer" install "$tmp/key.pub"
out_lacks "$token"
[[ ! -e "$prefix/var/lib/mawareeth-deploy/.ssh/authorized_keys2" ]] || fail 'authorized_keys2 was not removed'
for file in "$wrapper" "$entry"; do
  [[ -x "$file" && "$("$real_stat" -c %a "$file")" == 755 ]] || fail "$file is not mode 0755"
  { grep -Fxq "ci_checkout='$checkout'" "$file" && grep -Fxq "ci_prefix='$prefix'" "$file" \
    && grep -Fxq "ci_repo='example/mawareeth'" "$file" && grep -Fxq 'ci_prepare_timeout=60' "$file"; } || fail "$file lacks its baked settings"
done
{ grep -Fxq 'ci_role=release' "$wrapper" && grep -Fxq 'ci_role=entry' "$entry"; } || fail 'installed copies have the wrong roles'
sudoers="$prefix/etc/sudoers.d/91-mawareeth-deploy"
[[ "$(cat "$sudoers")" == "mawareeth-deploy ALL=(root) NOPASSWD: $wrapper ^[0-9a-f]{40}\$" ]] || fail "unexpected sudoers: $(cat "$sudoers")"
[[ "$("$real_stat" -c %a "$sudoers")" == 440 ]] || fail 'sudoers must be mode 0440'
cmp -s "$sudoers" "$S/visudo-checked" || fail 'the installed sudoers was not the one visudo checked'
keys="$prefix/var/lib/mawareeth-deploy/.ssh/authorized_keys"
[[ "$(cat "$keys")" == "from=\"100.64.0.0/10\",restrict,command=\"$entry\" $(cat "$tmp/key.pub")" ]] || fail "unexpected authorized_keys: $(cat "$keys")"
[[ "$(wc -l < "$keys")" == 1 ]] || fail 'authorized_keys must hold exactly one key'
grep -Fq 'useradd --system --user-group --no-create-home' "$S/accounts.log" || fail 'install did not create the system user'
grep -Fq "usermod --home $prefix/var/lib/mawareeth-deploy --shell /bin/sh --password * mawareeth-deploy" "$S/accounts.log" || fail 'install did not configure the account'
grep -Fq 'sshd -T -C user=mawareeth-deploy,' "$S/accounts.log" || fail 'install did not check the sshd key files'
# A second install keeps (and repairs) the existing user and replaces the key;
# an account with other groups is refused.
printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIRotatedKey0123456789abcdefABCDEFGH rotated\n' > "$tmp/key2.pub"
printf 'mawareeth-deploy docker\n' > "$S/groups"
run 64 bash "$installer" install "$tmp/key2.pub"; out_has 'belongs to other groups (mawareeth-deploy docker)'
rm -f "$S/groups"
repairs="$(grep -c '^usermod --home' "$S/accounts.log")"
run 0 bash "$installer" install "$tmp/key2.pub"
[[ "$(grep -c useradd "$S/accounts.log")" == 1 && "$(grep -c '^usermod --home' "$S/accounts.log")" == $((repairs + 1)) ]] || fail 'a second install must repair, not recreate, the user'
{ grep -Fq rotated "$keys" && ! grep -Fq ci-deploy@github "$keys"; } || fail 'the key was not replaced'
# Installed copies ignore the environment.
MAWAREETH_CI_PREFIX=/nonexistent run 64 "$wrapper" "$unknown_sha"
{ grep -Fq 'refused:' "$tmp/out" && ! grep -Fq /nonexistent "$tmp/out"; } || fail 'the installed wrapper honoured MAWAREETH_CI_PREFIX'

# --- wrapper fixtures ------------------------------------------------------
printf 'previous manifest\n' > "$tmp/previous"
reset_host() {
  rm -f "$checkout/.git/index.lock"
  g -C "$checkout" checkout -q -f -B master "$sha_a"
  cp "$tmp/previous" "$manifest"; chmod 0600 "$manifest"
  find "$S" -maxdepth 1 -type f \( -name 'fail-*' -o -name 'exit-*' -o -name 'sleep-*' -o -name 'started-*' -o -name 'break-*' \
    -o -name 'repo-digests' -o -name 'items-*' -o -name 'run-*' -o -name 'zip-*' \
    -o -name calls -o -name docker.log -o -name sudo.log -o -name curl.argv \) -delete
  add_artifact "$sha_b" 42 "$(manifest_json "$sha_b" "$digest_b")"
  ci_run 7 "$sha_b"; ci_run 8 "$sha_a"
}
head_is() {
  [[ "$(g -C "$checkout" rev-parse HEAD)" == "$1" ]] || fail "checkout is not at $1"
  [[ "$(g -C "$checkout" symbolic-ref -q HEAD)" == refs/heads/master ]] || fail 'the checkout is not on master'
}
unchanged() { # the previous checkout and manifest are in place
  head_is "$sha_a"
  cmp -s "$manifest" "$tmp/previous" || fail 'the previous manifest was not kept or restored'
  [[ "$("$real_stat" -c %a "$manifest")" == 600 ]] || fail 'the manifest must stay mode 0600'
  [[ ! -e "$S/calls" ]] || ! grep -q '^release.sh' "$S/calls" || fail 'release.sh ran'
}
no_token() {
  out_lacks "$token"
  [[ ! -e "$S/curl.argv" ]] || ! grep -Fq "$token" "$S/curl.argv" || fail 'the token was on a curl command line'
  ! grep -rFq "$token" "$logs" 2>/dev/null || fail 'the token is in a host log'
}
installed_is() { [[ "$(cat "$manifest")" == "$(manifest_json "$1" "$2")" ]] || fail "the manifest for $1 ($2) is not installed"; }

# --- Bad input: the entry refuses before sudo, the wrapper revalidates.
reset_host
bad_inputs=('' "${sha_b^^}" "${sha_b:0:39}" "${sha_b}0" "$sha_b deploy" "$sha_b;id" "$sha_b id" " $sha_b" "$sha_b " "$sha_b"$'\n' "$sha_b"$'\n'id
  "deploy --allow-contract" "recover" '$(id)' "g${sha_b:1}")
refusal='ci-deploy: refused: SSH_ORIGINAL_COMMAND must be exactly one 40-character lowercase commit SHA'
for input in "${bad_inputs[@]}"; do
  SSH_ORIGINAL_COMMAND="$input" run 64 "$entry"
  # The refusal names the input only; it never echoes it.
  [[ "$(cat "$tmp/out")" == "$refusal"$'\n''ci-deploy: result=input:64' ]] || fail "unexpected entry refusal for: $input"
done
(unset SSH_ORIGINAL_COMMAND; run 64 "$entry")
SSH_ORIGINAL_COMMAND="$sha_b" run 64 "$entry" "$sha_b"
[[ ! -e "$S/sudo.log" ]] || fail 'sudo ran for a refused input'
for input in "${bad_inputs[@]}"; do run 64 "$wrapper" "$input"; result_is input:64; done
run 64 "$wrapper"
run 64 "$wrapper" "$sha_b" "$sha_b"
run 64 "$wrapper" install "$tmp/key.pub"
unchanged
[[ ! -e "$S/curl.argv" && ! -e "$S/docker.log" ]] || fail 'a refused input reached curl or docker'

# --- Happy path through the entry: the SHA is the only payload.
reset_host
SSH_ORIGINAL_COMMAND="$sha_b" run 0 "$entry"
[[ "$(cat "$S/sudo.log")" == "sudo -n $wrapper $sha_b" ]] || fail "unexpected sudo call: $(cat "$S/sudo.log")"
head_is "$sha_b"
installed_is "$sha_b" "$digest_b"
[[ "$("$real_stat" -c %a "$manifest")" == 600 ]] || fail 'the installed manifest must be mode 0600'
expected_calls="runtime.sh prepare manifest=$manifest head=$sha_b fd8=closed"$'\n'"release.sh deploy manifest=$manifest head=$sha_b fd8=closed"
[[ "$(cat "$S/calls")" == "$expected_calls" ]] || fail "unexpected prepare/deploy calls: $(cat "$S/calls")"
[[ "$(cat "$S/docker.log")" == "docker pull --quiet ghcr.io/example/mawareeth@$digest_b"$'\n'"docker image inspect --format {{join .RepoDigests \"\\n\"}} ghcr.io/example/mawareeth@$digest_b" ]] \
  || fail "unexpected docker calls: $(cat "$S/docker.log")"
{ grep -Fq "actions/artifacts?name=release-manifest-$sha_b&per_page=100" "$S/curl.argv" && grep -Fq 'actions/runs/1042' "$S/curl.argv" \
  && grep -Fq 'actions/artifacts/42/zip' "$S/curl.argv"; } || fail 'the artifact and its run were not checked and downloaded'
out_has "deployed $sha_b"
result_is deploy:0
# The log is root-only, announced first, and complete.
log="$(sed -n '1s/^ci-deploy: log: //p' "$tmp/out")"
[[ -f "$log" && "$log" == "$logs"/ci-deploy-*.log && "$("$real_stat" -c %a "$log")" == 600 ]] || fail "no root-only log announced: $log"
{ grep -Fq "deployed $sha_b" "$log" && grep -Fxq 'ci-deploy: result=deploy:0' "$log"; } || fail 'the host log is incomplete'
# b changes ci-deploy.sh, so the installed wrapper (from a) is stale.
out_has "WARNING: deploy/ci-deploy.sh at $sha_b differs from the installed $wrapper"
no_token

# The release the wrapper was installed from deploys without the warning.
reset_host; add_artifact "$sha_a" 60 "$(manifest_json "$sha_a" "$digest_a")"
run 0 "$wrapper" "$sha_a"; out_lacks WARNING; head_is "$sha_a"; installed_is "$sha_a" "$digest_a"

# --- Artifact provenance: the newest artifact of a successful master
# Publish Release Image run of this repository for this SHA wins.
reset_host; add_artifact "$sha_b" 43 "$(manifest_json "$sha_b" "$digest_b2")"
run 0 "$wrapper" "$sha_b"; installed_is "$sha_b" "$digest_b2"
grep -Fq "docker pull --quiet ghcr.io/example/mawareeth@$digest_b2" "$S/docker.log" || fail 'the newest valid artifact was not deployed'
reset_host
add_artifact "$sha_b" 50 "$(manifest_json "$sha_b" "$digest_b2")" branch=side
add_artifact "$sha_b" 51 "$(manifest_json "$sha_b" "$digest_b2")" head_repo=2000 run_head_repo=1000
add_artifact "$sha_b" 52 "$(manifest_json "$sha_b" "$digest_b2")" path=.github/workflows/other.yml
add_artifact "$sha_b" 53 "$(manifest_json "$sha_b" "$digest_b2")" conclusion=failure
add_artifact "$sha_b" 54 "$(manifest_json "$sha_b" "$digest_b2")" event=push
add_artifact "$sha_b" 56 "$(manifest_json "$sha_b" "$digest_b2")" expired=true
add_artifact "$sha_b" 57 "$(manifest_json "$sha_b" "$digest_b2")" run_head_repo=2000
run 0 "$wrapper" "$sha_b"; installed_is "$sha_b" "$digest_b"; out_has "ignored 6 release-manifest-$sha_b artifact(s)"
! grep -Fq 'artifacts/5' "$S/curl.argv" || fail 'an invalid artifact was downloaded'
reset_host; rm -f "$S/items-$sha_b"
add_artifact "$sha_b" 50 "$(manifest_json "$sha_b" "$digest_b2")" branch=side
add_artifact "$sha_b" 52 "$(manifest_json "$sha_b" "$digest_b2")" path=.github/workflows/other.yml
run 64 "$wrapper" "$sha_b"; out_has 'no unexpired artifact'; out_has 'ignored 2'; unchanged; result_is artifact:64
# Master moved on before Publish Release Image started: its run (and the
# listing) report the newer head, and the artifact is still accepted.
reset_host; rm -f "$S/items-$sha_b"
add_artifact "$sha_b" 44 "$(manifest_json "$sha_b" "$digest_b2")" run_sha="$sha_a"
run 0 "$wrapper" "$sha_b"; installed_is "$sha_b" "$digest_b2"; out_lacks ignored

# --- The commit is proved by the manifest's Django CI run, before anything changes.
ci_refused() { # [key=value...] for run 7, or a manifest as "manifest=CONTENT"
  reset_host
  if [[ "${1:-}" == manifest=* ]]; then rm -f "$S/items-$sha_b"; add_artifact "$sha_b" 42 "${1#manifest=}"
  else ci_run 7 "$sha_b" "$@"; fi
  run 64 "$wrapper" "$sha_b"; unchanged; out_lacks 'checking out'
  [[ ! -e "$S/docker.log" ]] || fail 'docker ran without a proven commit'
}
for variant in path=.github/workflows/deploy.yml event=pull_request event=workflow_run branch=side conclusion=failure head_repo=2000; do
  ci_refused "$variant"; out_has "the manifest's CI run 7 is not a successful master Django CI push run of example/mawareeth for $sha_b"
done
reset_host; ci_run 7 "$sha_a"
run 64 "$wrapper" "$sha_b"; out_has "CI run 7 is not a successful master Django CI push run"; unchanged
reset_host; rm -f "$S/run-7"
run 64 "$wrapper" "$sha_b"; out_has "reading the manifest's Django CI run 7"; out_has 'HTTP 404'; unchanged
ci_refused "manifest=$(manifest_json "$sha_b" "$digest_b" '' abc)"; out_has 'rejected the manifest'
ci_refused "manifest=$(manifest_json "$sha_b" "$digest_b" '' 0)"; out_has 'rejected the manifest'
ci_refused "manifest=$(manifest_json "$sha_b" "$digest_b" | sed 's/,"workflow_run_id":"7"//')"; out_has 'rejected the manifest'
no_token

# --- Not on master.
reset_host
run 64 "$wrapper" "$sha_c"; out_has "refused: $sha_c is not on origin/master"; unchanged; result_is fetch:64
run 64 "$wrapper" "$unknown_sha"; out_has "refused: $unknown_sha is not on origin/master"; unchanged
[[ ! -e "$S/curl.argv" ]] || fail 'an off-master SHA reached the GitHub API'

# --- Local changes refuse before anything else changes (release.sh's check).
reset_host
printf 'local edit\n' >> "$checkout/deploy/runtime.sh"
run 64 "$wrapper" "$sha_b"; out_has 'has local changes under deploy/'
g -C "$checkout" checkout -q -- deploy/runtime.sh
printf 'untracked\n' > "$checkout/deploy/stray.txt"
run 64 "$wrapper" "$sha_b"; out_has 'has local changes under deploy/'; result_is preflight:64
rm -f "$checkout/deploy/stray.txt"
unchanged
[[ ! -e "$S/curl.argv" ]] || fail 'a dirty checkout reached the GitHub API'

# --- No manifest: missing, expired, API errors, bad or expired token.
reset_host; rm -f "$S/items-$sha_b"
run 64 "$wrapper" "$sha_b"; out_has "no unexpired artifact release-manifest-$sha_b"; unchanged; no_token
reset_host; rm -f "$S/items-$sha_b"; add_artifact "$sha_b" 5 "$(manifest_json "$sha_b" "$digest_b")" expired=true
run 64 "$wrapper" "$sha_b"; out_has 'no unexpired artifact'; unchanged
reset_host; touch "$S/fail-list"
run 64 "$wrapper" "$sha_b"; out_has 'listing artifact'; out_has 'HTTP 500'; unchanged; no_token
reset_host; touch "$S/fail-repo"
run 64 "$wrapper" "$sha_b"; out_has 'reading repository example/mawareeth'; unchanged
reset_host; touch "$S/fail-download"
run 64 "$wrapper" "$sha_b"; out_has 'downloading artifact'; unchanged; no_token
reset_host; printf 'github_pat_SOMEOTHERTOKEN0123456789\n' > "$token_file"
run 64 "$wrapper" "$sha_b"; out_has 'the GitHub read token is invalid or expired (HTTP 401)'; unchanged; no_token
! grep -Fq SOMEOTHERTOKEN "$tmp/out" || fail 'the token was printed'
printf '%s\n' "$token" > "$token_file"
reset_host; chmod 0644 "$token_file"
run 64 "$wrapper" "$sha_b"; out_has 'GitHub token file'; unchanged
chmod 0600 "$token_file"
reset_host; mv "$token_file" "$tmp/token.bak"
run 64 "$wrapper" "$sha_b"; out_has 'GitHub token file'; unchanged
mv "$tmp/token.bak" "$token_file"
[[ ! -e "$S/docker.log" ]] || fail 'docker ran without a manifest'

# --- Bad manifest: restored after the checkout.
bad_manifest() { # NEEDLE CONTENT [key=value...]
  local needle="$1"; shift
  reset_host; rm -f "$S/items-$sha_b"; add_artifact "$sha_b" 42 "$@"
  run 64 "$wrapper" "$sha_b"; out_has "$needle"; unchanged
  [[ ! -e "$S/docker.log" ]] || fail 'docker ran for a bad manifest'
}
bad_manifest 'rejected the manifest' "$(manifest_json "$sha_b" "$digest_b" ghcr.io/example/other)"
out_lacks 'checking out'; result_is validate:64
bad_manifest "deployment_bundle.git_sha is not $sha_b" "$(manifest_json "$sha_a" "$digest_b")"
bad_manifest 'rejected the manifest' '{"manifest_version": 1}'
bad_manifest 'rejected the manifest' 'not json'
bad_manifest 'is not a zip holding only release-manifest.json' "$(manifest_json "$sha_b" "$digest_b")" members=release-manifest.json,extra.json
reset_host; printf 'not a zip' > "$S/zip-42"
run 64 "$wrapper" "$sha_b"; out_has 'is not a zip'; unchanged

# --- Image and prepare failures: restored, exit code passed through.
reset_host; printf '17\n' > "$S/exit-pull"
run 17 "$wrapper" "$sha_b"; out_has 'docker pull of'; unchanged; result_is image:17
reset_host; printf 'ghcr.io/example/other@%s\n' "$digest_b" > "$S/repo-digests"
run 64 "$wrapper" "$sha_b"; out_has 'RepoDigests do not contain'; unchanged
reset_host; printf '2\n' > "$S/exit-runtime.sh"
run 2 "$wrapper" "$sha_b"; out_has 'runtime.sh prepare failed (exit 2'; unchanged; result_is prepare:2
grep -Fxq "runtime.sh prepare manifest=$manifest head=$sha_b fd8=closed" "$S/calls" || fail 'prepare did not run against the new release'
reset_host; printf '9\n' > "$S/exit-runtime.sh"
run 9 "$wrapper" "$sha_b"; unchanged
# Without a previous manifest, the restore removes the new one.
reset_host; rm -f "$manifest"; printf '2\n' > "$S/exit-runtime.sh"
run 2 "$wrapper" "$sha_b"; head_is "$sha_a"; [[ ! -e "$manifest" ]] || fail 'the new manifest was left behind'
# A restore that fails is CRITICAL (66).
reset_host; touch "$S/break-restore"; printf '2\n' > "$S/exit-runtime.sh"
run 66 "$wrapper" "$sha_b"; out_has 'CRITICAL: could not restore'; result_is prepare:66

# --- Deploy failure: not restored, exit code passed through.
reset_host; printf '5\n' > "$S/exit-release.sh"
run 5 "$wrapper" "$sha_b"; out_has 'release.sh deploy failed (exit 5)'; result_is deploy:5
head_is "$sha_b"; installed_is "$sha_b" "$digest_b"
out_lacks 'restored checkout'

# --- Signals: before release.sh deploy, restore (67); during it, wait for it.
reset_host; printf '30\n' > "$S/sleep-runtime.sh"
"$wrapper" "$sha_b" > "$tmp/out" 2>&1 & pid=$!
wait_for "$S/started-runtime.sh"
kill -TERM "$pid"; status=0; wait "$pid" || status=$?
[[ "$status" == 67 ]] || fail "TERM during prepare: expected 67, got $status"
out_has 'interrupted by SIGTERM during prepare'; result_is prepare:67; unchanged
reset_host; printf '2\n' > "$S/sleep-release.sh"; printf '5\n' > "$S/exit-release.sh"
"$wrapper" "$sha_b" > "$tmp/out" 2>&1 & pid=$!
wait_for "$S/started-release.sh"
kill -TERM "$pid"; status=0; wait "$pid" || status=$?
[[ "$status" == 5 ]] || fail "TERM during release.sh: expected its exit 5, got $status"
head_is "$sha_b"; out_lacks 'restored checkout'; result_is deploy:5

# --- A dropped SSH channel: the deploy still completes and is logged.
reset_host; printf '1\n' > "$S/sleep-release.sh"; rm -f "$logs"/ci-deploy-*.log
status=0; { "$wrapper" "$sha_b" 2>&1 || exit "$?"; } | head -c 1 > /dev/null || status=$?
[[ "$status" == 0 ]] || fail "a closed output channel changed the result: $status"
wait_for "$S/started-release.sh"
for _ in $(seq 50); do grep -q '^release.sh deploy' "$S/calls" 2>/dev/null && break; sleep 0.1; done
head_is "$sha_b"
log="$(find "$logs" -name 'ci-deploy-*.log' -print -quit)"
for _ in $(seq 50); do grep -Fxq 'ci-deploy: result=deploy:0' "$log" && break; sleep 0.1; done
grep -Fxq 'ci-deploy: result=deploy:0' "$log" || fail 'the log of a deploy with a closed channel is incomplete'

# --- Concurrent run: the lock refuses an overlap.
reset_host
exec 7>> "$prefix/run/mawareeth-ci-deploy.lock"
flock -n 7
run 65 "$wrapper" "$sha_b"; out_has "another CI deploy holds the lock $prefix/run/mawareeth-ci-deploy.lock"; unchanged; result_is lock:65
exec 7>&-
run 0 "$wrapper" "$sha_b"; head_is "$sha_b"

echo 'ci-deploy tests passed'
