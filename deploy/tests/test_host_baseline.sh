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
for forbidden_port in 2375 5432 8000; do
  if grep -Fq -- "port: \"$forbidden_port\"" "$provision" || grep -Fq -- "allow $forbidden_port" "$bootstrap"; then
    fail "forbidden public port $forbidden_port is present in the baseline"
  fi
done
need "$bootstrap" 'PasswordAuthentication no'
need "$bootstrap" 'PermitRootLogin no'
need "$bootstrap" 'PubkeyAuthentication yes'
need "$bootstrap" 'ufw --force reset'
need "$bootstrap" 'https://download.docker.com/linux/ubuntu'
need "$bootstrap" 'unattended-upgrades'
need "$bootstrap" '0700 /etc/mawareeth'
need "$bootstrap" '0600 /dev/null /etc/mawareeth/runtime.env'
need "$bootstrap" 'refusing unsafe ownership or mode on runtime secret file'
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
if HOST_BASELINE_CONFIG="$tmp/config" bash "$provision" >/dev/null 2>&1; then fail 'malformed CIDR was accepted'; fi
printf '%s\n' 'host baseline offline checks passed'

# Exercise both provisioner paths with provider/transport commands stubbed. This
# verifies reconciliation behavior without a Hetzner project or SSH host.
stub="$tmp/stub"
mkdir -p "$stub"
state="$tmp/state" log="$tmp/log"
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
  *'.ssh_key.public_key'*) printf '%s\n' "$TEST_PUBLIC_KEY" ;;
  *'.firewall.id'*) printf '1\n' ;;
  *'.server.server_type.name'*) printf 'cx33\n' ;;
  *'.server.datacenter.location.name'*) printf 'nbg1\n' ;;
  *'.server.image.name'*) printf 'ubuntu-24.04\n' ;;
  *'.server.labels.mawareeth_host_baseline'*) printf '1\n' ;;
  *'.action.id'*) printf '1\n' ;;
  *'applied_to'*) exit 1 ;;
  *'--argjson ssh_sources'*) printf '{"rules":[{"port":"80"},{"port":"443"},{"port":"22"}]}' ;;
  *'-R .'*) cat | sed 's/.*/"&"/' ;;
  *'-s .'*) printf '["198.51.100.0/24"]' ;;
  *) cat ;;
esac
EOF
cat > "$stub/ssh" <<'EOF'
#!/usr/bin/env bash
echo "ssh $*" >> "$TEST_LOG"
[[ "$*" == *'mawareeth-admin@'*' true' ]] && exit 1
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
need "$log" 'server apply-to-resource baseline-test-edge --type server --server baseline-test'
need "$log" 'port: "80"'
need "$log" 'port: "443"'
sed 's/SSH_ALLOWED_CIDRS=198.51.100.0\/24/SSH_ALLOWED_CIDRS=0.0.0.0\/0/' "$tmp/valid-config" > "$tmp/unrestricted-config"
chmod 600 "$tmp/unrestricted-config"
if TEST_LOG="$log" TEST_STATE="$state" TEST_PUBLIC_KEY="$pub" PATH="$stub:$PATH" HOST_BASELINE_CONFIG="$tmp/unrestricted-config" bash "$provision" >/dev/null 2>&1; then fail 'unrestricted SSH CIDR was accepted'; fi
