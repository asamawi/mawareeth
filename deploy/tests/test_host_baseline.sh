#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
provision="$root/deploy/provision-host.sh"
bootstrap="$root/deploy/bootstrap-host.sh"
example="$root/deploy/host-baseline.env.example"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
need() { grep -Fq -- "$2" "$1" || fail "missing $2 in $1"; }

bash -n "$provision" "$bootstrap" "$0"
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
exporter_exec='exec /usr/bin/prometheus-node-exporter --web.listen-address="\$ip:9100" --collector.textfile.directory=$textfile_dir'
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
need "$bootstrap" '0600 /dev/null /etc/mawareeth/runtime.env'
need "$bootstrap" 'refusing unsafe ownership or mode on runtime secret file'
# The Docker-port backstop must follow Docker restarts, not only host boots.
firewall_unit="$(sed -n '/^cat > \/etc\/systemd\/system\/mawareeth-docker-firewall.service/,/^EOF$/p' "$bootstrap")"
grep -qx 'BindsTo=docker.service' <<<"$firewall_unit" || fail 'firewall unit is not BindsTo=docker.service (stops when Docker crashes)'
grep -qx 'PartOf=docker.service' <<<"$firewall_unit" || fail 'firewall unit is not PartOf=docker.service'
grep -qx 'WantedBy=multi-user.target docker.service' <<<"$firewall_unit" || fail 'firewall unit is not wanted by docker.service'
need "$bootstrap" 'systemctl reenable mawareeth-docker-firewall.service'
need "$bootstrap" 'systemctl restart mawareeth-docker-firewall.service'
need "$provision" 'server describe'
need "$provision" 'actions/set_rules'
need "$example" 'SSH_ALLOWED_CIDRS='

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest baseline@test\n' > "$tmp/id.pub"
printf 'placeholder\n' > "$tmp/id"
cat > "$tmp/config" <<EOF
HETZNER_TOKEN=redacted
SERVER_NAME=baseline-test
HETZNER_SSH_KEY_NAME=baseline-test-key
SSH_PUBLIC_KEY=$tmp/id.pub
ADMIN_SSH_PRIVATE_KEY=$tmp/id
SSH_ALLOWED_CIDRS=not-a-cidr
EOF
chmod 600 "$tmp/config"
if HOST_BASELINE_CONFIG="$tmp/config" bash "$provision" >/dev/null 2>&1; then fail 'malformed CIDR was accepted'; fi
printf '%s\n' 'host baseline offline checks passed'

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
  *'.ssh_key.public_key'*) cat >/dev/null; printf '%s\n' "$TEST_PUBLIC_KEY" ;;
  *'.firewall.id'*) printf '1\n' ;;
  *'.server.server_type.name'*) printf 'cx33\n' ;;
  *'.server.datacenter.location.name'*) printf 'nbg1\n' ;;
  *'.server.image.name'*) printf 'ubuntu-24.04\n' ;;
  *'.server.labels.mawareeth_host_baseline'*) printf '1\n' ;;
  *'.action.id'*) printf '1\n' ;;
  *'length > 0'*) exit 1 ;;
  *'all(.firewall.applied_to'*) exit 0 ;;
  *'applied_to'*) exit 1 ;;
  *'--argjson ssh_sources'*) printf '{"rules": [{"port": "80"}, {"port": "443"}, {"port": "22"}]}' ;;
  *'-R .'*) cat | sed 's/.*/"&"/' ;;
  *'-s .'*) cat >/dev/null; printf '["198.51.100.0/24"]' ;;
  *) cat ;;
esac
EOF
cat > "$stub/ssh" <<'EOF'
#!/usr/bin/env bash
echo "ssh $*" >> "$TEST_LOG"
[[ "$*" == *'mawareeth-admin@'*' true' ]] && exit 1
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
TEST_LOG="$log" TEST_STATE="$state" TEST_PUBLIC_KEY="$pub" PATH="$stub:$PATH" HOST_BASELINE_CONFIG="$tmp/valid-config" bash "$provision"
TEST_LOG="$log" TEST_STATE="$state" TEST_PUBLIC_KEY="$pub" PATH="$stub:$PATH" HOST_BASELINE_CONFIG="$tmp/valid-config" bash "$provision"
[[ "$(grep -c 'server create' "$log")" == 1 ]] || fail 'repeat provision created a duplicate server'
need "$log" 'action wait 1'
need "$log" 'server enable-protection baseline-test delete'
need "$log" 'firewall apply-to-resource baseline-test-edge --type server --server baseline-test'
need "$log" '"port": "80"'
need "$log" '"port": "443"'
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
  *'.ssh_key.public_key'*) cat >/dev/null; printf '%s\n' "$key_value" ;;
  *'.server.server_type.name'*) printf '%s\n' "$server_type" ;;
  *'.server.datacenter.location.name'*) printf 'nbg1\n' ;;
  *'.server.image.name'*) printf 'ubuntu-24.04\n' ;;
  *'.server.labels.mawareeth_host_baseline'*) printf '1\n' ;;
  *'length > 0'*) exit 1 ;;
  *'all(.firewall.applied_to'*) if [[ "${MISMATCH_MODE:-}" == firewall ]]; then exit 1; else exit 0; fi ;;
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
