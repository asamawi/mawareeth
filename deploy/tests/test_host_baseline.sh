#!/usr/bin/env bash
# shellcheck disable=SC2016 # literal $ in bash -c and jq programs is intentional.
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
provision="$root/deploy/provision-host.sh"
bootstrap="$root/deploy/bootstrap-host.sh"
example="$root/deploy/host-baseline.env.example"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
need() { grep -Fq -- "$2" "$1" || fail "missing $2 in $1"; }

for f in "$provision" "$bootstrap" "$0"; do bash -n "$f" || fail "bash -n failed for ${f##*/} (syntax error or unreadable file)"; done
need "$provision" '--type cx33'
need "$provision" '--location nbg1'
need "$provision" '--image ubuntu-24.04'
need "$provision" 'enable-protection'
need "$provision" 'port: "80"'
need "$provision" 'port: "443"'
need "$provision" 'port: "22"'
# Match the port as a standalone number anywhere in either script, not just the
# two literal spellings above -- catches a multiport dports list, a port range,
# or a differently quoted/worded allow rule that would otherwise slip through.
contains_port() { grep -Eq -- "(^|[^0-9])$1([^0-9]|\$)" "$provision" "$bootstrap"; }
for forbidden_port in 2375 5432 8000 9100; do
  contains_port "$forbidden_port" && fail "forbidden public port $forbidden_port is present in the baseline"
done
# node_exporter (9100) may be opened only on tailscale0 from the tailnet range,
# by exactly one rule in deploy/monitor.sh; no other script may open it.
tailnet_rule='allow in on tailscale0 from 100.64.0.0/10 to any port 9100 proto tcp'
# The only other permitted mention is the exporter wrapper's exec line, matched
# whole so nothing appended to it can slip through.
# shellcheck disable=SC2016 # literal $ text matched against monitor.sh.
exporter_exec='exec /usr/bin/prometheus-node-exporter --web.listen-address="\$ip:9100" --collector.textfile.directory=$textfile_dir --collector.systemd'
monitor_prefix="$root/deploy/monitor.sh:"
while IFS= read -r hit; do
  line="${hit#"$monitor_prefix"}"
  if [[ "$line" != "$hit" && "$line" =~ ^[0-9]+:(.*)$ ]]; then
    line="${BASH_REMATCH[1]}"
    [[ "$line" == "ufw_rule=(${tailnet_rule})" || "$line" == "$exporter_exec" ]] && continue
  fi
  fail "9100 is opened outside 'in on tailscale0': $hit"
done < <(grep -En -- '(ufw|iptables|ip6tables|nft|firewall|port|allow|dport|listen).*(^|[^0-9])9100([^0-9]|$)' "$root"/deploy/*.sh | grep -Ev ':[0-9]+:[[:space:]]*#' || true)
# Compose and other deploy YAML (not the p1 snippets in deploy/monitoring/)
# must never publish or expose 9100.
shopt -s nullglob
for file in "$root"/deploy/*.yaml "$root"/deploy/*.yml; do
  ! grep -Ev '^[[:space:]]*#' "$file" | grep -Eq '(^|[^0-9])9100([^0-9]|$)' || fail "$file publishes or exposes port 9100"
done
shopt -u nullglob
grep -Fq "ufw_rule=(${tailnet_rule})" "$root/deploy/monitor.sh" || fail 'monitor.sh must open 9100 only with the tailscale0 rule'
# shellcheck disable=SC2016 # literal $ text matched against monitor.sh.
grep -Fq 'ufw "${ufw_rule[@]}"' "$root/deploy/monitor.sh" || fail 'monitor.sh must apply its tailscale0 UFW rule'
need "$bootstrap" 'PasswordAuthentication no'
need "$bootstrap" 'PermitRootLogin no'
need "$bootstrap" 'PubkeyAuthentication yes'
need "$bootstrap" 'ufw --force reset'
need "$bootstrap" 'https://download.docker.com/linux/ubuntu'
need "$bootstrap" 'unattended-upgrades'
need "$bootstrap" '0700 /etc/mawareeth'
need "$bootstrap" '/etc/cloud/cloud.cfg.d/99-mawareeth-no-network-hotplug.cfg'
need "$bootstrap" "when: ['boot-new-instance']"
need "$bootstrap" '0600 /dev/null /etc/mawareeth/runtime.env'
need "$bootstrap" 'refusing unsafe ownership or mode on runtime secret file'
# The Docker-port backstop must follow Docker restarts, not only host boots.
firewall_unit="$(sed -n '/^cat > \/etc\/systemd\/system\/mawareeth-docker-firewall.service/,/^EOF$/p' "$bootstrap")"
grep -qx 'BindsTo=docker.service' <<<"$firewall_unit" || fail 'firewall unit is not BindsTo=docker.service (stops when Docker crashes)'
grep -qx 'PartOf=docker.service' <<<"$firewall_unit" || fail 'firewall unit is not PartOf=docker.service'
grep -qx 'WantedBy=multi-user.target docker.service' <<<"$firewall_unit" || fail 'firewall unit is not wanted by docker.service'
# Container-originated traffic must reach Docker's own rules (RETURN, not ACCEPT,
# which would skip Docker's network isolation); inbound stays limited to 80/443.
need "$bootstrap" '-I DOCKER-USER 3 -i docker0 -j RETURN'
need "$bootstrap" '-I DOCKER-USER 4 -i br-+ -j RETURN'
grep -Eq -- '-i (docker0|br-\+) -j ACCEPT' "$bootstrap" && fail 'container egress must RETURN to Docker rules, not ACCEPT'
need "$bootstrap" 'systemctl reenable mawareeth-docker-firewall.service'
need "$bootstrap" 'systemctl restart mawareeth-docker-firewall.service'
need "$provision" 'server describe'
need "$provision" 'actions/set_rules'
need "$example" 'SSH_ALLOWED_CIDRS='
need "$example" 'PUBLIC_WEB_SOURCES='
# Real jq (when present) renders the exact Hetzner payload; CI must have it.
real_jq="$(command -v jq 2>/dev/null || true)"
if [[ -z "$real_jq" && -n "${CI:-}" ]]; then fail 'jq is required in CI'; fi
[[ -n "$real_jq" ]] || printf 'NOTE: jq is unavailable; skipping the exact Hetzner payload checks\n' >&2
# Cloudflare's ranges in file order, as provision-host.sh passes them on. Parse
# as provisioning does: strip comments, trim, and refuse a line with two tokens.
cf_file="$root/deploy/cloudflare-ips.txt"
cf_ranges=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="${line//$'\r'/}"
  read -r -a words <<<"$line"
  ((${#words[@]} <= 1)) || fail "deploy/cloudflare-ips.txt must hold one range per line: $line"
  ((${#words[@]} == 0)) || cf_ranges+=("${words[0]}")
done < "$cf_file"
cf_v4=() cf_v6=()
for range in "${cf_ranges[@]}"; do
  if [[ "$range" == *:* ]]; then cf_v6+=("$range"); else cf_v4+=("$range"); fi
done
((${#cf_v4[@]} > 0 && ${#cf_v6[@]} > 0)) || fail 'deploy/cloudflare-ips.txt must list IPv4 and IPv6 ranges'
cf_ranges=("${cf_v4[@]}" "${cf_v6[@]}")
cf_csv="$(IFS=','; printf '%s' "${cf_ranges[*]}")"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
ssh-keygen -q -t ed25519 -N '' -C baseline@test -f "$tmp/idpair" >/dev/null || fail 'ssh-keygen could not create the sample admin key'
{ cut -d' ' -f1,2 "$tmp/idpair.pub" | tr -d '\n'; printf ' baseline@test\n'; } > "$tmp/id.pub"
printf '%s\n' 'host baseline offline checks passed'

# PUBLIC_WEB_SOURCES on the guest: bootstrap's public-web block, exercised with
# a file-backed iptables/ip6tables stand-in and a logging ufw stub, so no host
# firewall is touched (even as root). The persisted mode and the UFW defaults
# live in the test directory.
web_lib="$tmp/web-sources.sh"
{
  printf '%s\n' 'die() { printf "bootstrap: %s\n" "$*" >&2; exit 1; }'
  sed -n '/^# >>> public web sources/,/^# <<< public web sources/p' "$bootstrap"
} > "$web_lib"
export MAWAREETH_PUBLIC_WEB_STATE="$tmp/public-web-sources"
export MAWAREETH_UFW_DEFAULTS="$tmp/ufw-defaults"
grep -q '^allow_public_web() {' "$web_lib" || fail 'bootstrap public web sources block not found'
need "$bootstrap" 'docker_firewall_script > /usr/local/sbin/mawareeth-docker-firewall'
for step_name in validate_web_sources require_ufw_ipv6 converge_docker_web_rules allow_public_web persist_web_sources; do
  [[ "$(grep -cx "$step_name" "$bootstrap")" == 1 ]] || fail "bootstrap must call $step_name exactly once"
done
line_of() { grep -nx -- "$1" "$bootstrap" | head -n 1 | cut -d: -f1; }
(($(line_of 'systemctl restart mawareeth-docker-firewall.service') < $(line_of converge_docker_web_rules))) || fail 'DOCKER-USER must be verified after the firewall unit restarts'
(($(line_of converge_docker_web_rules) < $(line_of 'ufw --force reset'))) || fail 'DOCKER-USER must be verified before UFW changes'
(($(line_of require_ufw_ipv6) < $(line_of 'docker_firewall_script > /usr/local/sbin/mawareeth-docker-firewall'))) || fail 'the UFW IPv6 check must come before any firewall change'
(($(line_of 'install -d -o root -g root -m 0700 /etc/mawareeth') < $(line_of persist_web_sources))) || fail 'the mode must be persisted inside /etc/mawareeth'
# Guest input validation: bootstrap's guest-inputs block (validate_cidrs and
# validate_admin), run in fresh child shells with explicit env. Nothing on the
# host is touched.
for step_name in validate_cidrs validate_admin; do
  [[ "$(grep -cx "$step_name" "$bootstrap")" == 1 ]] || fail "bootstrap must call $step_name exactly once"
done
(($(line_of validate_cidrs) < $(line_of validate_web_sources))) || fail 'validate_cidrs must run before validate_web_sources'
(($(line_of validate_web_sources) < $(line_of validate_admin))) || fail 'validate_admin must run after validate_web_sources'
(($(line_of validate_admin) < $(line_of 'apt-get update'))) || fail 'validate_admin must run before any host change'
guest_lib="$tmp/guest-inputs.sh"
# Exactly one marker pair, opening first: a lost closing marker would make sed
# copy the rest of bootstrap, whose top level changes the host when sourced.
[[ "$(grep -c '^# >>> guest inputs' "$bootstrap"):$(grep -c '^# <<< guest inputs' "$bootstrap")" == 1:1 ]] || fail 'bootstrap must have exactly one guest inputs marker pair'
(($(grep -n '^# >>> guest inputs' "$bootstrap" | cut -d: -f1) < $(grep -n '^# <<< guest inputs' "$bootstrap" | cut -d: -f1))) || fail 'the guest inputs markers are out of order'
{
  printf '%s\n' 'die() { printf "bootstrap: %s\n" "$*" >&2; exit 1; }'
  sed -n '/^# >>> guest inputs/,/^# <<< guest inputs/p' "$bootstrap"
} > "$guest_lib"
grep -q '^validate_cidrs() {' "$guest_lib" || fail 'bootstrap guest inputs block not found'
grep -q '^validate_admin() {' "$guest_lib" || fail 'bootstrap validate_admin not found in the guest inputs block'
guest_accepts() { # function env-assignment...
  local fn="$1"
  shift
  env -u SSH_ALLOWED_CIDRS -u ADMIN_USER -u ADMIN_PUBLIC_KEY "$@" \
    bash -c 'set -Eeuo pipefail; source "$1"; "$2"' _ "$guest_lib" "$fn" >/dev/null 2>&1 \
    || fail "bootstrap $fn refused: $*"
}
guest_refuses() { # function expected-message env-assignment...
  local fn="$1" want="$2" out
  shift 2
  if out="$(env -u SSH_ALLOWED_CIDRS -u ADMIN_USER -u ADMIN_PUBLIC_KEY "$@" \
    bash -c 'set -Eeuo pipefail; source "$1"; "$2"' _ "$guest_lib" "$fn" 2>&1)"; then
    fail "bootstrap $fn accepted: $*"
  fi
  [[ "$out" == *"bootstrap: "*"$want"* ]] || fail "bootstrap $fn refusal for $* does not say '$want': $out"
}
for cidrs in 203.0.113.0/24 198.51.100.7/32,2001:db8::/48 10.0.0.0/8 2001:db8::/32 203.0.113.5/24; do
  guest_accepts validate_cidrs "SSH_ALLOWED_CIDRS=$cidrs"
done
guest_refuses validate_cidrs 'SSH_ALLOWED_CIDRS is required'
guest_refuses validate_cidrs 'SSH_ALLOWED_CIDRS is required' SSH_ALLOWED_CIDRS=
guest_refuses validate_cidrs 'contains an empty CIDR' SSH_ALLOWED_CIDRS=203.0.113.0/24,,198.51.100.0/24
for cidrs in '203.0.113.0/24,' ',203.0.113.0/24'; do
  guest_refuses validate_cidrs 'contains an empty CIDR' "SSH_ALLOWED_CIDRS=$cidrs"
done
for cidrs in $'203.0.113.0/24\n198.51.100.0/24' '203.0.113.0/24, 198.51.100.0/24' $'203.0.113.0/24\n'; do
  guest_refuses validate_cidrs 'without spaces or newlines' "SSH_ALLOWED_CIDRS=$cidrs"
done
for cidrs in not-a-cidr 10.0.0.0/7 0.0.0.0/0 2001:db8::/31 ::/0 203.0.113.0/24,10.0.0.0/7 203.0.113.0/24,2001:db8::/31; do
  guest_refuses validate_cidrs 'invalid or excessively broad CIDR' "SSH_ALLOWED_CIDRS=$cidrs"
done
good_key="$(cat "$tmp/id.pub")"
for admin in deploy _svc a-b_1 abcdefghijklmnopqrstuvwxyz012345; do
  guest_accepts validate_admin "ADMIN_USER=$admin" "ADMIN_PUBLIC_KEY=$good_key"
done
sample_key() { # type [key byte count]: a well-formed key line (type header plus key bytes)
  python3 -c 'import base64, sys
t = sys.argv[1].encode()
print(sys.argv[1], base64.b64encode(len(t).to_bytes(4, "big") + t + bytes(range(int(sys.argv[2])))).decode(), "c")' "$1" "${2:-32}"
}
b64_ed="${good_key#ssh-ed25519 }"; b64_ed="${b64_ed%% *}"
tab_key="ssh-ed25519"$'\t'"$b64_ed"$'\t'"baseline@test"
canonical_key="$(sample_key ssh-ed25519 1)"
noncanonical_key="$(python3 -c 'import sys
ktype, payload, comment = sys.argv[1].split()
if not payload.endswith("AA=="):
    sys.exit("expected AA== padding for the one-byte key")
print(ktype, payload[:-4] + "AB==", comment)' "$canonical_key")"
for key in "$good_key" "$tab_key" "$canonical_key" "ssh-ed25519 $b64_ed" "$(sample_key ecdsa-sha2-nistp256)" "$(sample_key sk-ssh-ed25519@openssh.com 33)" "$(sample_key sk-ecdsa-sha2-nistp256@openssh.com 7)"; do
  guest_accepts validate_admin ADMIN_USER=deploy "ADMIN_PUBLIC_KEY=$key"
done
# The accepted values reach the rest of bootstrap unchanged (sudoers, authorized_keys).
for key in "$good_key" "$tab_key"; do
  kept="$(env ADMIN_USER=deploy "ADMIN_PUBLIC_KEY=$key" \
    bash -c 'set -Eeuo pipefail; source "$1"; validate_admin; printf "%s|%s" "$ADMIN_USER" "$ADMIN_PUBLIC_KEY"' _ "$guest_lib")" \
    || fail 'bootstrap validate_admin refused the suite key'
  [[ "$kept" == "deploy|$key" ]] || fail "validate_admin changed the admin values: $kept"
done
for admin in '' Deploy 1deploy abcdefghijklmnopqrstuvwxyz0123456 'de ploy'; do
  guest_refuses validate_admin 'ADMIN_USER is required and must be valid' "ADMIN_USER=$admin" "ADMIN_PUBLIC_KEY=$good_key"
done
guest_refuses validate_admin 'ADMIN_USER is required and must be valid' "ADMIN_PUBLIC_KEY=$good_key"
for key in '' ssh-ed25519 'AAAAC3NzaC1lZDI1NTE5AAAAITest c' 'rsa AAAAB3NzaC1yc2E c' \
  'ssh-ed25519 ' 'ssh-ed25519  ' 'ssh-ed25519 not*base64 c' 'ssh-ed25519 AAAACw=' 'ssh-ed25519 AAAACw==' \
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5' "ssh-rsa $b64_ed c" "$good_key"$'\n'"ssh-ed25519 $b64_ed evil" "$good_key"$'\r' \
  "ssh-ed25519"$'\v'"$b64_ed baseline@test" "ssh-ed25519 $b64_ed"$'\xc2\xa0'"baseline@test" "$noncanonical_key"; do
  guest_refuses validate_admin 'ADMIN_PUBLIC_KEY is required and must be a valid OpenSSH public key' ADMIN_USER=deploy "ADMIN_PUBLIC_KEY=$key"
done
printf '%s\n' 'bootstrap guest input checks passed'
# Sandboxed run of bootstrap-host.sh itself: a copy that differs only in the root
# check and the /etc/os-release path, run with stub executables for every
# host-mutating command. Each stub logs its call and exits with a sentinel, so a
# run stops at the first host change (nothing after it, including redirections
# into /etc that a PATH stub cannot intercept, ever runs, even as root).
sandbox="$tmp/bootstrap-sandbox"
mkdir -p "$sandbox/bin"
sbx_osrel="$sandbox/os-release"
printf -v sbx_osrel_q '%q' "$sbx_osrel"
sbx_sentinel=97
root_check="[[ \${EUID:-999} -eq 0 ]] || die 'must run as root'"
[[ "$(grep -cxF -- "$root_check" "$bootstrap")" == 1 ]] || fail 'bootstrap root check not found exactly once'
osrel_lines="$(grep -cF -- '/etc/os-release' "$bootstrap" || true)"
((osrel_lines >= 2)) || fail 'bootstrap must read /etc/os-release at least twice'
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == "$root_check" ]]; then
    printf '%s\n' ':'
  else
    printf '%s\n' "${line//\/etc\/os-release/"$sbx_osrel_q"}"
  fi
done < "$bootstrap" > "$sandbox/bootstrap-host.sh"
! grep -qF -- '/etc/os-release' "$sandbox/bootstrap-host.sh" || fail 'the sandbox copy still reads /etc/os-release'
sbx_diff="$(diff "$bootstrap" "$sandbox/bootstrap-host.sh" || true)"
[[ "$(grep -c '^<' <<<"$sbx_diff")" == "$((osrel_lines + 1))" && "$(grep -c '^>' <<<"$sbx_diff")" == "$((osrel_lines + 1))" ]] \
  || fail "the sandbox copy differs from bootstrap beyond the root check and os-release path: $sbx_diff"
cat > "$sandbox/stub" <<'STUB'
#!/usr/bin/env bash
{ printf '%s' "${0##*/}"; for a in "$@"; do printf ' %s' "$a"; done; printf '\n'; } >> "$MUTATION_LOG"
exit 97
STUB
chmod +x "$sandbox/stub"
for stub_name in apt-get install curl gpg chmod chown dpkg systemctl useradd visudo sshd ufw iptables ip6tables mv rm; do
  cp "$sandbox/stub" "$sandbox/bin/$stub_name"
done
sbx_base=("SSH_ALLOWED_CIDRS=203.0.113.0/24" "ADMIN_USER=deploy" "ADMIN_PUBLIC_KEY=$good_key")
sbx_run() { # case-name os-id[:version] override...: sets sbx_status, sbx_err, sbx_log. "NAME=v" replaces a base value, "-NAME" unsets it, other NAME=v adds one.
  local name="$1" os_release="$2" version=24.04 entry key over skip
  local envs=()
  shift 2
  [[ "$os_release" != *:* ]] || version="${os_release#*:}"
  printf 'ID=%s\nVERSION_ID=%s\nVERSION_CODENAME=noble\n' "${os_release%%:*}" "$version" > "$sbx_osrel"
  for entry in "${sbx_base[@]}"; do
    key="${entry%%=*}" skip=
    for over in "$@"; do
      [[ "${over%%=*}" == "$key" || "$over" == "-$key" ]] && skip=1
    done
    [[ -n "$skip" ]] || envs+=("$entry")
  done
  for over in "$@"; do
    [[ "$over" == -* ]] || envs+=("$over")
  done
  : > "$sandbox/log"
  sbx_status=0
  env -i PATH="$sandbox/bin:$PATH" MUTATION_LOG="$sandbox/log" \
    MAWAREETH_PUBLIC_WEB_STATE="$tmp/public-web-sources" MAWAREETH_UFW_DEFAULTS="$tmp/ufw-defaults" \
    "${envs[@]}" "$BASH" "$sandbox/bootstrap-host.sh" >"$sandbox/out" 2>"$sandbox/err" || sbx_status=$?
  sbx_err="$(cat "$sandbox/err")"
  sbx_log="$(cat "$sandbox/log")"
  : "$name"
}
sbx_accepts() { # case-name os-id[:version] override...
  local name="$1"
  sbx_run "$@"
  [[ "$sbx_status" == "$sbx_sentinel" && "$sbx_log" == 'apt-get update' ]] \
    || fail "sandbox case '$name': expected the first host change to be 'apt-get update' (status $sbx_sentinel), got status $sbx_status, log '$sbx_log', stderr '$sbx_err'"
}
sbx_refuses() { # case-name expected-message os-id[:version] override...
  local name="$1" want="$2"
  shift 2
  sbx_run "$name" "$@"
  [[ "$sbx_status" == 1 && "$sbx_err" == *"bootstrap: "*"$want"* && -z "$sbx_log" ]] \
    || fail "sandbox case '$name': expected exit 1 with '$want' and no host change, got status $sbx_status, stderr '$sbx_err', log '$sbx_log'"
}
sbx_accepts 'valid input' ubuntu
sbx_accepts 'valid Cloudflare input' ubuntu PUBLIC_WEB_SOURCES=cloudflare "PUBLIC_WEB_RANGES=$cf_csv"
sbx_refuses 'missing CIDRs' 'SSH_ALLOWED_CIDRS is required' ubuntu -SSH_ALLOWED_CIDRS
sbx_refuses 'trailing comma CIDR' 'contains an empty CIDR' ubuntu 'SSH_ALLOWED_CIDRS=203.0.113.0/24,'
sbx_refuses 'broad CIDR' 'invalid or excessively broad CIDR' ubuntu SSH_ALLOWED_CIDRS=0.0.0.0/0
sbx_refuses 'bad web mode' 'PUBLIC_WEB_SOURCES must be any or cloudflare' ubuntu PUBLIC_WEB_SOURCES=bogus
sbx_refuses 'cloudflare without ranges' 'PUBLIC_WEB_RANGES' ubuntu PUBLIC_WEB_SOURCES=cloudflare
sbx_refuses 'bad admin user' 'ADMIN_USER is required and must be valid' ubuntu ADMIN_USER=Root
sbx_refuses 'bad admin key' 'ADMIN_PUBLIC_KEY is required and must be a valid OpenSSH public key' ubuntu 'ADMIN_PUBLIC_KEY=ssh-ed25519 AAAA'
sbx_refuses 'wrong OS' 'Ubuntu 24.04 is required' debian
sbx_refuses 'wrong Ubuntu version' 'Ubuntu 24.04 is required' ubuntu:22.04
printf '%s\n' 'bootstrap sandboxed run checks passed'
# The sudoers file stays today's: sudo's NOPASSWD ALL already admits the
# command-line variables that provisioning passes.
need "$bootstrap" "\\nDefaults:%s env_keep += \"SSH_ALLOWED_CIDRS ADMIN_USER ADMIN_PUBLIC_KEY\"\\n' \"\$ADMIN_USER\" \"\$ADMIN_USER\" > \"/etc/sudoers.d/90-\$ADMIN_USER\""
# With PUBLIC_WEB_SOURCES absent (nothing persisted), empty or any, the
# generated script is today's, byte for byte.
cat > "$tmp/fw-expected-any" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
restrict() {
  local bin="$1"
  command -v "$bin" >/dev/null 2>&1 || return 0
  "$bin" -N DOCKER-USER 2>/dev/null || true
  "$bin" -C DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || "$bin" -I DOCKER-USER 1 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
  "$bin" -C DOCKER-USER -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null || "$bin" -I DOCKER-USER 2 -p tcp -m multiport --dports 80,443 -j ACCEPT
  # Traffic that containers start (DNS, Brevo, Storage Box) leaves
  # through Docker's bridges. RETURN hands it back to Docker's own forwarding
  # and isolation rules; only traffic arriving from outside is limited to 80/443.
  "$bin" -C DOCKER-USER -i docker0 -j RETURN 2>/dev/null || "$bin" -I DOCKER-USER 3 -i docker0 -j RETURN
  "$bin" -C DOCKER-USER -i br-+ -j RETURN 2>/dev/null || "$bin" -I DOCKER-USER 4 -i br-+ -j RETURN
  "$bin" -C DOCKER-USER -j DROP 2>/dev/null || "$bin" -A DOCKER-USER -j DROP
}
restrict iptables
restrict ip6tables
SCRIPT
for any_env in 'unset PUBLIC_WEB_SOURCES' 'PUBLIC_WEB_SOURCES=' 'PUBLIC_WEB_SOURCES=any'; do
  bash -c 'set -Eeuo pipefail; source "$1"; eval "$2"; validate_web_sources; docker_firewall_script' _ "$web_lib" "$any_env" > "$tmp/fw-any" \
    || fail "bootstrap refused $any_env"
  cmp -s "$tmp/fw-any" "$tmp/fw-expected-any" || fail "the any-mode Docker firewall script differs from today's ($any_env)"
done
# Bootstrap refuses a bad mode or bad ranges before changing anything, naming the key.
web_refuses() { # expected-key mode ranges
  local out
  if out="$(PUBLIC_WEB_SOURCES="$2" PUBLIC_WEB_RANGES="$3" bash -c 'source "$1"; validate_web_sources' _ "$web_lib" 2>&1)"; then
    fail "bootstrap accepted PUBLIC_WEB_SOURCES=$2 PUBLIC_WEB_RANGES=$3"
  fi
  [[ "$out" == *"$1"* ]] || fail "bootstrap refusal for PUBLIC_WEB_SOURCES=$2 PUBLIC_WEB_RANGES=$3 does not name $1: $out"
}
web_refuses PUBLIC_WEB_SOURCES other ''
web_refuses PUBLIC_WEB_SOURCES Cloudflare ''
web_refuses PUBLIC_WEB_RANGES any "$cf_csv"
web_refuses PUBLIC_WEB_RANGES cloudflare ''
for bad in "$cf_csv,0.0.0.0/0" "$cf_csv,::/0" "$cf_csv,10.0.0.0/7" "$cf_csv,2000::/11" "$cf_csv,not-a-cidr" \
  "$cf_csv,192.0.2.1/24" "$cf_csv,2400:CB01::/32" "$cf_csv,${cf_v4[0]}" "$cf_csv," "${cf_v4[0]}" "${cf_v6[0]}"; do
  web_refuses PUBLIC_WEB_RANGES cloudflare "$bad"
done
if out="$(PUBLIC_WEB_RANGES="$cf_csv" bash -c 'unset PUBLIC_WEB_SOURCES; source "$1"; validate_web_sources' _ "$web_lib" 2>&1)"; then
  fail 'bootstrap accepted PUBLIC_WEB_RANGES without PUBLIC_WEB_SOURCES'
fi
[[ "$out" == *PUBLIC_WEB_RANGES* ]] || fail "refusal of ranges without a mode does not name PUBLIC_WEB_RANGES: $out"
# The mode persists: a cloudflare run, then a run without PUBLIC_WEB_SOURCES,
# keeps cloudflare; an explicit value always wins.
web_mode() { # shell snippet run before validation; prints "mode ranges"
  bash -c 'set -Eeuo pipefail; source "$1"; eval "$2"; validate_web_sources; printf "%s %s\n" "$PUBLIC_WEB_SOURCES" "$PUBLIC_WEB_RANGES"' _ "$web_lib" "$1"
}
rm -f "$MAWAREETH_PUBLIC_WEB_STATE"
PUBLIC_WEB_SOURCES=cloudflare PUBLIC_WEB_RANGES="$cf_csv" bash -c 'set -Eeuo pipefail; source "$1"; validate_web_sources; persist_web_sources' _ "$web_lib" \
  || fail 'persisting the cloudflare mode failed'
[[ "$(stat -c '%a' "$MAWAREETH_PUBLIC_WEB_STATE")" == 644 ]] || fail 'the persisted mode file must be mode 0644'
[[ "$(cat "$MAWAREETH_PUBLIC_WEB_STATE")" == "PUBLIC_WEB_SOURCES=cloudflare"$'\n'"PUBLIC_WEB_RANGES=$cf_csv" ]] || fail 'the persisted mode file has unexpected content'
[[ "$(web_mode 'unset PUBLIC_WEB_SOURCES PUBLIC_WEB_RANGES')" == "cloudflare $cf_csv" ]] || fail 'a run without PUBLIC_WEB_SOURCES did not keep the persisted cloudflare mode'
[[ "$(web_mode 'PUBLIC_WEB_SOURCES=any; unset PUBLIC_WEB_RANGES')" == 'any ' ]] || fail 'an explicit PUBLIC_WEB_SOURCES=any did not win over the persisted mode'
chmod 0666 "$MAWAREETH_PUBLIC_WEB_STATE"
if out="$(web_mode 'unset PUBLIC_WEB_SOURCES PUBLIC_WEB_RANGES' 2>&1)"; then fail 'a writable persisted mode file was accepted'; fi
[[ "$out" == *"$MAWAREETH_PUBLIC_WEB_STATE"* ]] || fail "unsafe persisted mode refusal does not name the file: $out"
printf 'PUBLIC_WEB_SOURCES=cloudflare\nPUBLIC_WEB_RANGES=0.0.0.0/0\n' > "$MAWAREETH_PUBLIC_WEB_STATE"
chmod 0644 "$MAWAREETH_PUBLIC_WEB_STATE"
if web_mode 'unset PUBLIC_WEB_SOURCES PUBLIC_WEB_RANGES' >/dev/null 2>&1; then fail 'a catch-all persisted range was accepted'; fi
rm -f "$MAWAREETH_PUBLIC_WEB_STATE"
# UFW must filter IPv6 before the cloudflare lock is applied.
ufw_ipv6() { # mode defaults-content
  printf '%s\n' "$2" > "$MAWAREETH_UFW_DEFAULTS"
  local ranges=''
  [[ "$1" == cloudflare ]] && ranges="$cf_csv"
  PUBLIC_WEB_SOURCES="$1" PUBLIC_WEB_RANGES="$ranges" bash -c 'set -Eeuo pipefail; source "$1"; validate_web_sources; require_ufw_ipv6' _ "$web_lib" 2>&1
}
ufw_ipv6 cloudflare 'IPV6=yes' >/dev/null || fail 'cloudflare mode refused IPV6=yes'
if out="$(ufw_ipv6 cloudflare 'IPV6=no')"; then fail 'cloudflare mode accepted IPV6=no'; fi
[[ "$out" == *IPV6=yes* && "$out" == *"$MAWAREETH_UFW_DEFAULTS"* ]] || fail "the UFW IPv6 refusal does not name the setting and file: $out"
ufw_ipv6 any 'IPV6=no' >/dev/null || fail 'any mode must not depend on UFW IPv6'
# File-backed DOCKER-USER stand-in: one rule spec per line, per binary. It
# refuses an address of the wrong family, so v4/v6 crossing fails loudly.
fw_stub="$tmp/fw-stub"
mkdir -p "$fw_stub"
cat > "$fw_stub/iptables" <<'EOF'
#!/usr/bin/env bash
set -u
bin="${0##*/}" op="$1" chain_name="${2:-}"
chain="$FW_STATE/$bin"
[[ "$chain_name" == DOCKER-USER ]] || { echo "unexpected chain $chain_name" >&2; exit 2; }
shift 2
prev=''
for arg in "$@"; do
  if [[ "$prev" == -s ]]; then
    if [[ "$bin" == iptables && "$arg" == *:* ]] || [[ "$bin" == ip6tables && "$arg" != *:* ]]; then
      echo "$bin: wrong address family $arg" >&2; exit 2
    fi
  fi
  prev="$arg"
done
case "$op" in
  -N) [[ -e "$chain" ]] && exit 1; : > "$chain" ;;
  -S) [[ -e "$chain" ]] || exit 1; echo '-N DOCKER-USER'; sed 's/^/-A DOCKER-USER /' "$chain" ;;
  -C) [[ -e "$chain" ]] && grep -Fxq -- "$*" "$chain" ;;
  -A) [[ -e "$chain" ]] || exit 1; printf '%s\n' "$*" >> "$chain" ;;
  -I)
    [[ -e "$chain" ]] || exit 1
    position="$1"; shift
    count="$(wc -l < "$chain")"
    ((position >= 1 && position <= count + 1)) || { echo "$bin: index of insertion too big" >&2; exit 1; }
    awk -v p="$position" -v r="$*" 'NR == p { print r } { print } END { if (NR < p) print r }' "$chain" > "$chain.new" && mv "$chain.new" "$chain" ;;
  -D)
    [[ -e "$chain" ]] && grep -Fxq -- "$*" "$chain" || { echo "$bin: no such rule" >&2; exit 1; }
    awk -v r="$*" '!done && $0 == r { done = 1; next } { print }' "$chain" > "$chain.new" && mv "$chain.new" "$chain" ;;
  *) echo "unexpected operation $op" >&2; exit 2 ;;
esac
EOF
cp "$fw_stub/iptables" "$fw_stub/ip6tables"
cat > "$fw_stub/ufw" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$UFW_LOG"
EOF
chmod +x "$fw_stub"/*
fw_state="$tmp/fw-state"
mkdir -p "$fw_state"
fw_env=(FW_STATE="$fw_state" PATH="$fw_stub:$PATH")
# One bootstrap pass: generate the script, run it as the unit would, then
# converge and verify as bootstrap does.
web_apply() { # mode [ranges csv]
  local ranges=''
  [[ "$1" == cloudflare ]] && ranges="${2:-$cf_csv}"
  env "${fw_env[@]}" PUBLIC_WEB_SOURCES="$1" PUBLIC_WEB_RANGES="$ranges" \
    bash -c 'set -Eeuo pipefail; source "$1"; validate_web_sources; docker_firewall_script > "$2"; bash "$2"; converge_docker_web_rules' \
    _ "$web_lib" "$tmp/fw-script-$1" || fail "bootstrap firewall pass failed for $1"
}
expected_chain() { # mode family [ranges csv]
  printf '%s\n' '-m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT'
  if [[ "$1" == any ]]; then
    printf '%s\n' '-p tcp -m multiport --dports 80,443 -j ACCEPT'
  else
    local range family
    local -a range_list
    IFS=',' read -r -a range_list <<<"${3:-$cf_csv}"
    for range in "${range_list[@]}"; do
      family=4
      if [[ "$range" == *:* ]]; then family=6; fi
      if [[ "$family" == "$2" ]]; then
        printf -- '-s %s -p tcp -m multiport --dports 80,443 -j ACCEPT\n' "$range"
      fi
    done
  fi
  printf '%s\n' '-i docker0 -j RETURN' '-i br-+ -j RETURN' '-j DROP'
}
check_chains() { # mode step [ranges csv]
  [[ "$(cat "$fw_state/iptables")" == "$(expected_chain "$1" 4 "${3:-}")" ]] || fail "iptables DOCKER-USER after $2 is not exactly the $1 rules, in order: $(cat "$fw_state/iptables")"
  [[ "$(cat "$fw_state/ip6tables")" == "$(expected_chain "$1" 6 "${3:-}")" ]] || fail "ip6tables DOCKER-USER after $2 is not exactly the $1 rules, in order: $(cat "$fw_state/ip6tables")"
}
# Fresh host, rerun, switch both ways, rerun: every run leaves exactly its mode's rules.
step=0
for mode in any any cloudflare cloudflare any cloudflare; do
  step=$((step + 1))
  web_apply "$mode"
  check_chains "$mode" "step $step ($mode)"
done
# A fresh host in cloudflare mode gets the same chains as one switched to it.
rm -f "$fw_state"/*
web_apply cloudflare
check_chains cloudflare 'a fresh cloudflare run'
# The baked script keeps the families apart and carries no catch-all range.
cf_script="$tmp/fw-script-cloudflare"
grep -qx "restrict iptables ${cf_v4[*]}" "$cf_script" || fail 'the cloudflare firewall script does not restrict iptables to the IPv4 ranges'
grep -qx "restrict ip6tables ${cf_v6[*]}" "$cf_script" || fail 'the cloudflare firewall script does not restrict ip6tables to the IPv6 ranges'
! grep -Eq -- '0\.0\.0\.0/0|::/0' "$cf_script" || fail 'the cloudflare firewall script carries a catch-all range'
grep -Eq -- '-i (docker0|br-\+) -j ACCEPT' "$cf_script" && fail 'container egress must RETURN to Docker rules, not ACCEPT'
# Every Docker start converges: the baked script alone removes a stray
# unsourced or unlisted 80/443 accept, and bootstrap's check catches one.
add_stray() { # bin rule-spec
  env "${fw_env[@]}" bash -c 'IFS=" " read -r -a a <<<"$2"; "$1" -I DOCKER-USER 2 "${a[@]}"' _ "$1" "$2"
}
for stray in 'iptables -p tcp -m multiport --dports 80,443 -j ACCEPT' \
  'iptables -s 198.51.100.0/24 -p tcp -m multiport --dports 80,443 -j ACCEPT' \
  'ip6tables -p tcp -m multiport --dports 80,443 -j ACCEPT' \
  'ip6tables -s 2001:db8:ffff::/48 -p tcp -m multiport --dports 80,443 -j ACCEPT'; do
  add_stray "${stray%% *}" "${stray#* }"
  if out="$(env "${fw_env[@]}" PUBLIC_WEB_SOURCES=cloudflare PUBLIC_WEB_RANGES="$cf_csv" bash -c 'set -Eeuo pipefail; source "$1"; validate_web_sources; converge_docker_web_rules' _ "$web_lib" 2>&1)"; then
    fail "bootstrap verification accepted a stray accept in cloudflare mode: $stray"
  fi
  [[ "$out" == *"${stray%% *} DOCKER-USER does not accept 80/443 from exactly"* ]] || fail "unexpected verification failure for $stray: $out"
  env "${fw_env[@]}" bash "$cf_script" || fail 'the cloudflare firewall script failed on a drifted chain'
  check_chains cloudflare "a Docker start after a stray $stray"
done
rm -f "$fw_state"/*
web_apply any
env "${fw_env[@]}" bash -c 'iptables -A DOCKER-USER -s 198.51.100.0/24 -p tcp -m multiport --dports 80,443 -j ACCEPT'
if env "${fw_env[@]}" PUBLIC_WEB_SOURCES=any bash -c 'set -Eeuo pipefail; source "$1"; validate_web_sources; verify_web_accepts iptables -' _ "$web_lib" >/dev/null 2>&1; then
  fail 'bootstrap verification accepted a sourced 80/443 accept in any mode'
fi
# Range refresh: list A, then B (one IPv4 and one IPv6 range removed, two
# added), then A again; each run leaves exactly its list, in list order.
refresh_v4=() refresh_v6=()
for range in "${cf_v4[@]}"; do [[ "$range" == "${cf_v4[2]}" ]] || refresh_v4+=("$range"); done
for range in "${cf_v6[@]}"; do [[ "$range" == "${cf_v6[1]}" ]] || refresh_v6+=("$range"); done
refresh_csv="$(IFS=','; printf '%s' "${refresh_v4[*]},192.0.2.0/24,${refresh_v6[*]},2001:db8::/32")"
rm -f "$fw_state"/*
for list in A B A; do
  ranges="$cf_csv"
  [[ "$list" == B ]] && ranges="$refresh_csv"
  web_apply cloudflare "$ranges"
  check_chains cloudflare "range list $list" "$ranges"
done
# UFW: today's two allows in any mode; otherwise one 80/443 allow per range only.
ufw_for() { # mode
  local ranges=''
  [[ "$1" == cloudflare ]] && ranges="$cf_csv"
  : > "$tmp/ufw-log"
  PUBLIC_WEB_SOURCES="$1" PUBLIC_WEB_RANGES="$ranges" UFW_LOG="$tmp/ufw-log" PATH="$fw_stub:$PATH" \
    bash -c 'set -Eeuo pipefail; source "$1"; validate_web_sources; allow_public_web' _ "$web_lib" || fail "UFW public web rules failed for $1"
  cat "$tmp/ufw-log"
}
[[ "$(ufw_for any)" == $'allow 80/tcp\nallow 443/tcp' ]] || fail 'any-mode UFW commands differ from today'"'"'s'
[[ "$(ufw_for cloudflare)" == "$(printf 'allow proto tcp from %s to any port 80,443\n' "${cf_ranges[@]}")" ]] \
  || fail 'cloudflare-mode UFW must allow 80/443 only from each Cloudflare range'
unset MAWAREETH_PUBLIC_WEB_STATE MAWAREETH_UFW_DEFAULTS
printf '%s\n' 'public web source checks passed'

# Exercise both provisioner paths with provider/transport commands stubbed. This
# verifies reconciliation behavior without a Hetzner project or SSH host.
stub="$tmp/stub"
mkdir -p "$stub"
state="$tmp/state" log="$tmp/log"
mkdir -p "$state"
cat > "$stub/hcloud" <<'EOF'
#!/usr/bin/env bash
set -e
echo "hcloud $*" >> "$TEST_LOG"
case "$1 $2 $3" in
  "ssh-key describe baseline-test-key") [[ -e "$TEST_STATE/key" ]] || exit 1; printf '{"ssh_key":{"public_key":"%s"}}\n' "$TEST_PUBLIC_KEY" ;;
  "ssh-key create --name") touch "$TEST_STATE/key" ;;
  "firewall describe baseline-test-edge") printf '{"firewall":{"id":1,"applied_to":[]}}\n' ;;
  "firewall create --name") : ;;
  "server describe baseline-test") [[ -e "$TEST_STATE/server" ]] || exit 1; printf '{"server":{"id":2,"server_type":{"name":"cx33"},"datacenter":{"location":{"name":"nbg1"}},"image":{"name":"ubuntu-24.04"},"labels":{"mawareeth_host_baseline":"1"}}}\n' ;;
  "server create --name") touch "$TEST_STATE/server" ;;
  "server enable-protection baseline-test") : ;;
  "server apply-to-resource baseline-test-edge") : ;;
  "server ip baseline-test") printf '203.0.113.10\n' ;;
  "action wait 1") : ;;
  *) exit 0 ;;
esac
EOF
cat > "$stub/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$TEST_LOG"
printf '{"action":{"id":1}}\n'
EOF
cat > "$stub/jq" <<'EOF'
#!/usr/bin/env bash
args="$*"
case "$args" in
  # Piped from hcloud: drain stdin so the writer never gets SIGPIPE under pipefail.
  *'(.ssh_key // .).public_key'*) cat >/dev/null; printf '%s\n' "$TEST_PUBLIC_KEY" ;;
  *'(.firewall // .).id'*) printf '1\n' ;;
  *'(.server // .).server_type.name'*) printf 'cx33\n' ;;
  *'(.location.name // .datacenter.location.name)'*) printf 'nbg1\n' ;;
  *'(.server // .).image.name'*) printf 'ubuntu-24.04\n' ;;
  *'(.server // .).labels.mawareeth_host_baseline'*) printf '1\n' ;;
  *'.actions[]?.id'*) printf '1\n' ;;
  *'length > 0'*) exit 1 ;;
  *'all((.firewall // .).applied_to'*) exit 0 ;;
  *'applied_to'*) exit 1 ;;
  # The rules payload: record the arguments, and render it with real jq when available.
  *'--argjson ssh_sources'*)
    printf '%s\n' "$@" > "$TEST_STATE/payload-args"
    if [[ -n "${REAL_JQ:-}" ]]; then "$REAL_JQ" "$@" | tee "$TEST_STATE/payload.json"
    else printf '{"rules": [{"port": "80"}, {"port": "443"}, {"port": "22"}]}'; fi ;;
  *'-R .'*) cat | sed 's/.*/"&"/' ;;
  *'-s .'*) cat >/dev/null; printf '["198.51.100.0/24"]' ;;
  *) cat ;;
esac
EOF
cat > "$stub/ssh" <<'EOF'
#!/usr/bin/env bash
echo "ssh $*" >> "$TEST_LOG"
[[ "$*" == *'mawareeth-admin@'*' true' && -z "${SSH_ADMIN_OK:-}" ]] && exit 1
exit 0
EOF
cat > "$stub/scp" <<'EOF'
#!/usr/bin/env bash
echo "scp $*" >> "$TEST_LOG"
EOF
chmod +x "$stub"/*
ssh-keygen -q -t ed25519 -N '' -f "$tmp/pair"
pub="$(tr -d '\r\n' < "$tmp/pair.pub")"
cat > "$tmp/valid-config" <<EOF
HETZNER_TOKEN=redacted
SERVER_NAME=baseline-test
HETZNER_SSH_KEY_NAME=baseline-test-key
SSH_PUBLIC_KEY=$tmp/pair.pub
ADMIN_SSH_PRIVATE_KEY=$tmp/pair
SSH_ALLOWED_CIDRS=198.51.100.0/24
EOF
chmod 600 "$tmp/valid-config"
provision_with() { # config [provision script], stubbed; extra arguments are ignored
  TEST_LOG="$log" TEST_STATE="$state" TEST_PUBLIC_KEY="$pub" REAL_JQ="$real_jq" PATH="$stub:$PATH" HOST_BASELINE_CONFIG="$1" bash "${2:-$provision}"
}
provision_with "$tmp/valid-config"
provision_with "$tmp/valid-config"
[[ "$(grep -c 'server create' "$log")" == 1 ]] || fail 'repeat provision created a duplicate server'
need "$log" 'action wait 1'
need "$log" 'server enable-protection baseline-test delete rebuild'
need "$log" 'firewall apply-to-resource baseline-test-edge --type server --server baseline-test'
need "$log" '"port": "80"'
need "$log" '"port": "443"'

# PUBLIC_WEB_SOURCES in provisioning. Absent (today's host-baseline.env), empty
# or "any": the Hetzner payload is today's, and bootstrap gets no ranges.
today_payload='{"rules":[{"direction":"in","protocol":"tcp","port":"80","source_ips":["0.0.0.0/0","::/0"]},{"direction":"in","protocol":"tcp","port":"443","source_ips":["0.0.0.0/0","::/0"]},{"direction":"in","protocol":"tcp","port":"22","source_ips":["198.51.100.0/24"]}]}'
check_default_payload() { # label
  grep -Fxq -- '["0.0.0.0/0", "::/0"]' "$state/payload-args" || fail "$1: the Hetzner 80/443 sources are not 0.0.0.0/0 and ::/0"
  if [[ -n "$real_jq" ]]; then
    [[ "$("$real_jq" -cS . "$state/payload.json")" == "$("$real_jq" -cS . <<<"$today_payload")" ]] || fail "$1: the Hetzner rules payload differs from today's"
  fi
  [[ "$(grep '^ssh .*bash /tmp/mawareeth-bootstrap-host.sh' "$log" | tail -n 1)" == *' PUBLIC_WEB_SOURCES=any bash /tmp/mawareeth-bootstrap-host.sh' ]] \
    || fail "$1: bootstrap was not told PUBLIC_WEB_SOURCES=any without ranges"
}
check_default_payload 'absent PUBLIC_WEB_SOURCES'
for value in '' any; do
  { cat "$tmp/valid-config"; printf 'PUBLIC_WEB_SOURCES=%s\n' "$value"; } > "$tmp/web-config"
  chmod 600 "$tmp/web-config"
  provision_with "$tmp/web-config"
  check_default_payload "PUBLIC_WEB_SOURCES=$value"
done
# cloudflare: both web rules list exactly the file's ranges, and bootstrap
# receives the mode and the ranges.
{ cat "$tmp/valid-config"; printf 'PUBLIC_WEB_SOURCES=cloudflare\n'; } > "$tmp/cloudflare-config"
chmod 600 "$tmp/cloudflare-config"
provision_with "$tmp/cloudflare-config"
cf_json="$(printf '"%s", ' "${cf_ranges[@]}")"
cf_json="[${cf_json%, }]"
grep -Fxq -- "$cf_json" "$state/payload-args" || fail 'cloudflare mode did not pass the Cloudflare ranges as the Hetzner 80/443 sources'
if [[ -n "$real_jq" ]]; then
  for port in 80 443; do
    # shellcheck disable=SC2016 # $port is a jq variable.
    [[ "$("$real_jq" -c --arg port "$port" '[.rules[] | select(.port == $port)] | map(.source_ips)' "$state/payload.json")" == "[$("$real_jq" -c . <<<"$cf_json")]" ]] \
      || fail "cloudflare mode: the Hetzner port $port rule does not list exactly the Cloudflare ranges"
  done
  [[ "$("$real_jq" -c '[.rules[] | select(.port == "22") | .source_ips]' "$state/payload.json")" == '[["198.51.100.0/24"]]' ]] \
    || fail 'cloudflare mode changed the Hetzner SSH rules'
fi
[[ "$(grep '^ssh .*bash /tmp/mawareeth-bootstrap-host.sh' "$log" | tail -n 1)" == *" PUBLIC_WEB_SOURCES=cloudflare PUBLIC_WEB_RANGES=$(printf %q "$cf_csv") bash /tmp/mawareeth-bootstrap-host.sh" ]] \
  || fail "cloudflare mode did not pass the mode and ranges to bootstrap: $(grep '^ssh .*bash /tmp/mawareeth-bootstrap-host.sh' "$log" | tail -n 1)"
# Through the administrator account they travel as sudo command-line
# assignments (the sudoers file keeps no extra variables).
SSH_ADMIN_OK=1 provision_with "$tmp/cloudflare-config"
[[ "$(grep '^ssh .*bash /tmp/mawareeth-bootstrap-host.sh' "$log" | tail -n 1)" == *"mawareeth-admin@203.0.113.10 sudo SSH_ALLOWED_CIDRS="*" PUBLIC_WEB_SOURCES=cloudflare PUBLIC_WEB_RANGES=$(printf %q "$cf_csv") bash /tmp/mawareeth-bootstrap-host.sh" ]] \
  || fail "the sudo bootstrap command does not carry the mode and ranges: $(grep '^ssh .*bash /tmp/mawareeth-bootstrap-host.sh' "$log" | tail -n 1)"
# Refusals happen before any provider or transport call and name the key or file.
provision_refuses() { # expected-name config [provision script]
  local out
  : > "$log"
  if out="$(provision_with "$2" "${3:-$provision}" 2>&1)"; then fail "provisioning accepted a config that must be refused ($1)"; fi
  [[ "$out" == *"$1"* ]] || fail "refusal does not name $1: $out"
  [[ "$out" != *redacted* ]] || fail 'refusal printed the Hetzner token'
  ! grep -Eq '^(hcloud|curl|ssh|scp) ' "$log" || fail "refusal for $1 contacted Hetzner or the host first"
}
{ cat "$tmp/valid-config"; printf 'PUBLIC_WEB_SOURCES=other\n'; } > "$tmp/bad-mode-config"
chmod 600 "$tmp/bad-mode-config"
provision_refuses PUBLIC_WEB_SOURCES "$tmp/bad-mode-config"
for bad in 'not-a-cidr:invalid or excessively broad CIDR' '203.0.113.0/24,:contains an empty CIDR' ',203.0.113.0/24:contains an empty CIDR' $'203.0.113.0/24\n198.51.100.0/24:without spaces or newlines' '203.0.113.0/24, 198.51.100.0/24:without spaces or newlines'; do
  { sed '/^SSH_ALLOWED_CIDRS=/d' "$tmp/valid-config"; printf 'SSH_ALLOWED_CIDRS=%q\n' "${bad%:*}"; } > "$tmp/bad-cidr-config"
  chmod 600 "$tmp/bad-cidr-config"
  provision_refuses "${bad##*:}" "$tmp/bad-cidr-config"
done
copy="$tmp/ranges-copy"
mkdir -p "$copy"
cp "$provision" "$copy/provision-host.sh"
bad_ranges() { # file content (printf %b), or "missing"; [expected message]
  rm -f "$copy/cloudflare-ips.txt"
  [[ "$1" == missing ]] || printf '%b' "$1" > "$copy/cloudflare-ips.txt"
  provision_refuses "${2:-deploy/cloudflare-ips.txt}" "$tmp/cloudflare-config" "$copy/provision-host.sh"
}
v4_line="${cf_v4[0]}\n" v6_line="${cf_v6[0]}\n"
bad_ranges missing
bad_ranges ''
bad_ranges '# comments only\n\n'
bad_ranges "${v4_line}not-a-cidr\n${v6_line}"
bad_ranges "${v4_line}192.0.2.1/24\n${v6_line}"
bad_ranges "${v4_line}192.0.2.1\n${v6_line}"
bad_ranges "${v4_line}0.0.0.0/0\n${v6_line}"
bad_ranges "${v4_line}${v6_line}::/0\n"
bad_ranges "${v4_line}10.0.0.0/7\n${v6_line}"
bad_ranges "${v4_line}${v6_line}2000::/11\n"
bad_ranges "${v4_line}${v4_line}${v6_line}"
bad_ranges "${cf_v4[0]} ${cf_v4[1]}\n${v6_line}" 'deploy/cloudflare-ips.txt must hold one range per line'
bad_ranges "${v4_line}${cf_v6[0]}\t${cf_v6[1]}\n" 'deploy/cloudflare-ips.txt must hold one range per line'
bad_ranges "$v4_line"
bad_ranges "$v6_line"
# The tracked file itself is accepted by the copied provisioner.
cp "$cf_file" "$copy/cloudflare-ips.txt"
provision_with "$tmp/cloudflare-config" "$copy/provision-host.sh" >/dev/null
printf '%s\n' 'public web source provisioning checks passed'
sed 's/SSH_ALLOWED_CIDRS=198.51.100.0\/24/SSH_ALLOWED_CIDRS=0.0.0.0\/0/' "$tmp/valid-config" > "$tmp/unrestricted-config"
chmod 600 "$tmp/unrestricted-config"
if TEST_LOG="$log" TEST_STATE="$state" TEST_PUBLIC_KEY="$pub" PATH="$stub:$PATH" HOST_BASELINE_CONFIG="$tmp/unrestricted-config" bash "$provision" >/dev/null 2>&1; then fail 'unrestricted SSH CIDR was accepted'; fi

# Conflict/drift detection: an existing server, SSH key, or firewall that does not
# match this baseline must abort for an operator decision, never silently mutate.
mismatch_stub="$tmp/mismatch-stub"
mkdir -p "$mismatch_stub"
cat > "$mismatch_stub/hcloud" <<'EOF'
#!/usr/bin/env bash
set -e
echo "hcloud $*" >> "$TEST_LOG"
server_type=cx33; [[ "${MISMATCH_MODE:-}" == server ]] && server_type=cx22
key_value="$TEST_PUBLIC_KEY"; [[ "${MISMATCH_MODE:-}" == key ]] && key_value='ssh-ed25519 AAAADIFFERENTKEYDATA different@test'
case "$1 $2 $3" in
  "ssh-key describe baseline-test-key") printf '{"ssh_key":{"public_key":"%s"}}\n' "$key_value" ;;
  "firewall describe baseline-test-edge") printf '{"firewall":{"id":1,"applied_to":[]}}\n' ;;
  "server describe baseline-test") printf '{"server":{"id":2,"server_type":{"name":"%s"},"datacenter":{"location":{"name":"nbg1"}},"image":{"name":"ubuntu-24.04"},"labels":{"mawareeth_host_baseline":"1"}}}\n' "$server_type" ;;
  *) exit 0 ;;
esac
EOF
cat > "$mismatch_stub/jq" <<'EOF'
#!/usr/bin/env bash
args="$*"
server_type=cx33; [[ "${MISMATCH_MODE:-}" == server ]] && server_type=cx22
key_value="$TEST_PUBLIC_KEY"; [[ "${MISMATCH_MODE:-}" == key ]] && key_value='ssh-ed25519 AAAADIFFERENTKEYDATA different@test'
case "$args" in
  # Piped from hcloud: drain stdin so the writer never gets SIGPIPE under pipefail.
  *'(.ssh_key // .).public_key'*) cat >/dev/null; printf '%s\n' "$key_value" ;;
  *'(.server // .).server_type.name'*) printf '%s\n' "$server_type" ;;
  *'(.location.name // .datacenter.location.name)'*) printf 'nbg1\n' ;;
  *'(.server // .).image.name'*) printf 'ubuntu-24.04\n' ;;
  *'(.server // .).labels.mawareeth_host_baseline'*) printf '1\n' ;;
  *'(.server // .).id'*) printf '1\n' ;;
  *'length > 0'*) exit 1 ;;
  *'all((.firewall // .).applied_to'*) if [[ "${MISMATCH_MODE:-}" == firewall ]]; then exit 1; else exit 0; fi ;;
  *) cat ;;
esac
EOF
cat > "$mismatch_stub/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$TEST_LOG"
printf '{"action":{"id":1}}\n'
EOF
chmod +x "$mismatch_stub"/*
for mode in server key firewall; do
  mismatch_log="$tmp/mismatch-log-$mode"
  if MISMATCH_MODE="$mode" TEST_LOG="$mismatch_log" TEST_PUBLIC_KEY="$pub" PATH="$mismatch_stub:$PATH" HOST_BASELINE_CONFIG="$tmp/valid-config" bash "$provision" >/dev/null 2>&1; then
    fail "conflicting $mode was accepted instead of aborting for an operator decision"
  fi
  grep -Eq -- 'server create|enable-protection|apply-to-resource|^curl ' "$mismatch_log" 2>/dev/null && fail "conflict detection for $mode mutated provider state instead of aborting first"
done
printf '%s\n' 'conflict/drift detection checks passed'

# Apt signing-key pin: bootstrap's apt key pin block, run against the committed
# copies of the real vendor keys (no network).
fixtures="$root/deploy/tests/fixtures"
[[ "$(grep -c '^# >>> apt key pin' "$bootstrap"):$(grep -c '^# <<< apt key pin' "$bootstrap")" == 1:1 ]] || fail 'bootstrap must have exactly one apt key pin marker pair'
(($(grep -n '^# >>> apt key pin' "$bootstrap" | cut -d: -f1) < $(grep -n '^# <<< apt key pin' "$bootstrap" | cut -d: -f1))) || fail 'the apt key pin markers are out of order'
pin_lib="$tmp/apt-key-pin.sh"
sed -n '/^# >>> apt key pin/,/^# <<< apt key pin/p' "$bootstrap" > "$pin_lib"
grep -q '^key_fingerprint_matches() {' "$pin_lib" || fail 'bootstrap apt key pin block not found'
need "$pin_lib" 'docker_key_fingerprint=9DC858229FC7DD38854AE2D88D81803C0EBFCD88'
pin_matches() { bash -c 'set -Eeuo pipefail; source "$1"; key_fingerprint_matches "$2" "$3"' _ "$pin_lib" "$@" >/dev/null 2>&1; }
docker_pin=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
pin_matches "$fixtures/docker-archive-keyring.asc" "$docker_pin" || fail 'the genuine Docker key was refused'
pin_matches "$fixtures/tailscale-archive-keyring.gpg" 2596A99EAAB33821893C0A79458CA832957F5868 || fail 'the helper refused the genuine Tailscale key against its own pin'
pin_matches "$fixtures/tailscale-archive-keyring.gpg" "$docker_pin" && fail 'a different valid key was accepted as the Docker key'
gpg --batch --dearmor < "$fixtures/docker-archive-keyring.asc" > "$tmp/two-keys.gpg"
cat "$fixtures/tailscale-archive-keyring.gpg" >> "$tmp/two-keys.gpg"
pin_matches "$tmp/two-keys.gpg" "$docker_pin" && fail 'a file with an extra key was accepted'
: > "$tmp/empty.key"
pin_matches "$tmp/empty.key" "$docker_pin" && fail 'an empty file was accepted as a key'
printf 'not a key\n' > "$tmp/text.key"
pin_matches "$tmp/text.key" "$docker_pin" && fail 'a text file was accepted as a key'
pin_matches "$tmp/missing.key" "$docker_pin" && fail 'a missing file was accepted as a key'
(($(line_of 'apt-get install -y --no-install-recommends ca-certificates curl gnupg sudo ufw unattended-upgrades') < $(grep -n 'key_fingerprint_matches "\$docker_key_dir' "$bootstrap" | cut -d: -f1))) || fail 'the Docker key check must come after gnupg is installed'
key_check_line="$(grep -n 'key_fingerprint_matches "\$docker_key_dir' "$bootstrap" | cut -d: -f1)"
[[ "$(grep -cE '^key_fingerprint_matches "\$docker_key_dir/docker\.key" "\$docker_key_fingerprint" \|\| die ' "$bootstrap")" == 1 ]] || fail 'bootstrap must call key_fingerprint_matches on the Docker key exactly once, followed by || die'
(($(grep -n 'download.docker.com/linux/ubuntu/gpg' "$bootstrap" | cut -d: -f1) < key_check_line)) || fail 'the Docker key must be downloaded before it is checked'
(($(grep -n 'gpg --dearmor' "$bootstrap" | cut -d: -f1) > key_check_line)) || fail 'the Docker key must be checked before gpg --dearmor'
(($(grep -n 'docker.list' "$bootstrap" | head -n 1 | cut -d: -f1) > key_check_line)) || fail 'the Docker key must be checked before docker.list is written'
! grep -Eq 'curl .*\| *gpg' "$bootstrap" || fail 'bootstrap must not pipe a downloaded key straight into gpg'
printf '%s\n' 'apt key pin checks passed'
