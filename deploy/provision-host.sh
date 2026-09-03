#!/usr/bin/env bash
# Operator-only Hetzner reconciliation. Never run this from CI.
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

die() { printf 'provision: %s\n' "$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"; }
config_file="${HOST_BASELINE_CONFIG:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/host-baseline.env}"
[[ -f "$config_file" ]] || die 'operator configuration is required; copy deploy/host-baseline.env.example outside version control'
[[ "$(stat -c '%U:%a' "$config_file")" == "$(id -un):600" ]] || die 'operator configuration must be owned by the invoking user and mode 0600'
# shellcheck disable=SC1090
source "$config_file"

validate_cidrs() {
  [[ -n "${SSH_ALLOWED_CIDRS:-}" ]] || die 'SSH_ALLOWED_CIDRS is required'
  local cidr
  IFS=',' read -r -a cidrs <<<"$SSH_ALLOWED_CIDRS"
  ((${#cidrs[@]} > 0)) || die 'SSH_ALLOWED_CIDRS must contain at least one CIDR'
  for cidr in "${cidrs[@]}"; do
    [[ -n "$cidr" ]] || die 'SSH_ALLOWED_CIDRS contains an empty CIDR'
    [[ "$cidr" != '0.0.0.0/0' && "$cidr" != '::/0' ]] || die 'SSH_ALLOWED_CIDRS must not permit unrestricted SSH access'
    python3 - "$cidr" <<'PY' || die 'SSH_ALLOWED_CIDRS contains an invalid CIDR'
import ipaddress
import sys
ipaddress.ip_network(sys.argv[1], strict=False)
PY
  done
}

for required in HETZNER_TOKEN SERVER_NAME HETZNER_SSH_KEY_NAME SSH_PUBLIC_KEY ADMIN_SSH_PRIVATE_KEY SSH_ALLOWED_CIDRS; do
  [[ -n "${!required:-}" ]] || die "$required is required"
done
[[ -r "$SSH_PUBLIC_KEY" ]] || die 'SSH_PUBLIC_KEY must name a readable public-key file'
[[ -r "$ADMIN_SSH_PRIVATE_KEY" ]] || die 'ADMIN_SSH_PRIVATE_KEY must name a readable private-key file'
[[ "$SERVER_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$ ]] || die 'SERVER_NAME is invalid'
validate_cidrs
require_command python3
require_command hcloud
require_command jq
require_command curl
require_command ssh
require_command scp
require_command ssh-keygen
export HCLOUD_TOKEN="$HETZNER_TOKEN"
FIREWALL_NAME="${FIREWALL_NAME:-${SERVER_NAME}-edge}"
ADMIN_USER="${ADMIN_USER:-mawareeth-admin}"
[[ "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die 'ADMIN_USER is invalid'

configured_key="$(tr -d '\r\n' < "$SSH_PUBLIC_KEY")"
private_key="$(ssh-keygen -y -f "$ADMIN_SSH_PRIVATE_KEY")" || die 'ADMIN_SSH_PRIVATE_KEY is not a usable private key'
[[ "${configured_key% *}" == "$private_key" ]] || die 'configured public and private SSH keys do not match'

# Inspect an existing host before changing any provider resource. A matching name
# must be explicitly labelled as a baseline host before this script may reconcile it.
server_exists=false
if hcloud server describe "$SERVER_NAME" --output json >/dev/null 2>&1; then
  server_exists=true
  server_json="$(hcloud server describe "$SERVER_NAME" --output json)"
  type="$(jq -r '.server.server_type.name' <<<"$server_json")"
  location="$(jq -r '.server.datacenter.location.name' <<<"$server_json")"
  image="$(jq -r '.server.image.name' <<<"$server_json")"
  managed="$(jq -r '.server.labels.mawareeth_host_baseline // empty' <<<"$server_json")"
  [[ "$type" == cx33 && "$location" == nbg1 && "$image" == ubuntu-24.04 && "$managed" == 1 ]] || die 'existing server is conflicting or not managed by this baseline; operator decision required'
fi

# A named key is reused; a different public key under the same identity is an operator decision.
if ! hcloud ssh-key describe "$HETZNER_SSH_KEY_NAME" >/dev/null 2>&1; then
  hcloud ssh-key create --name "$HETZNER_SSH_KEY_NAME" --public-key-from-file "$SSH_PUBLIC_KEY" >/dev/null
else
  existing_key="$(hcloud ssh-key describe "$HETZNER_SSH_KEY_NAME" --output json | jq -r '.ssh_key.public_key')"
  [[ "$configured_key" == "$existing_key" ]] || die 'existing SSH-key identity has different public key; operator decision required'
fi

# Replace the rule set atomically: public web only, and SSH only from explicit CIDRs.
IFS=',' read -r -a cidrs <<<"$SSH_ALLOWED_CIDRS"
cidr_json="$(printf '%s\n' "${cidrs[@]}" | jq -R . | jq -s .)"
rules_payload="$(jq -n --argjson ssh_sources "$cidr_json" '
  {rules: [
    {direction: "in", protocol: "tcp", port: "80", source_ips: ["0.0.0.0/0", "::/0"]},
    {direction: "in", protocol: "tcp", port: "443", source_ips: ["0.0.0.0/0", "::/0"]}
  ] + ($ssh_sources | map({direction: "in", protocol: "tcp", port: "22", source_ips: [.]}) )}')"
if hcloud firewall describe "$FIREWALL_NAME" >/dev/null 2>&1; then
  firewall_json="$(hcloud firewall describe "$FIREWALL_NAME" --output json)"
  if [[ "$server_exists" == false ]] && jq -e '.firewall.applied_to | length > 0' <<<"$firewall_json" >/dev/null; then
    die 'configured firewall is already attached to another server; operator decision required'
  fi
  if [[ "$server_exists" == true ]] && ! jq -e --arg server "$SERVER_NAME" 'all(.firewall.applied_to[]?; .type != "server" or .server.name == $server)' <<<"$firewall_json" >/dev/null; then
    die 'configured firewall is shared with another server; operator decision required'
  fi
else
  hcloud firewall create --name "$FIREWALL_NAME" >/dev/null
fi
firewall_json="$(hcloud firewall describe "$FIREWALL_NAME" --output json)"
firewall_id="$(jq -r '.firewall.id' <<<"$firewall_json")"
action_json="$(curl --fail --silent --show-error --request POST \
  --header "Authorization: Bearer $HETZNER_TOKEN" \
  --header 'Content-Type: application/json' \
  --data "$rules_payload" \
  "https://api.hetzner.cloud/v1/firewalls/${firewall_id}/actions/set_rules")"
action_id="$(jq -r '.action.id // empty' <<<"$action_json")"
[[ -n "$action_id" ]] || die 'firewall rule update did not return an action id'
hcloud action wait "$action_id" >/dev/null

if [[ "$server_exists" == false ]]; then
  hcloud server create --name "$SERVER_NAME" --type cx33 --location nbg1 --image ubuntu-24.04 --ssh-key "$HETZNER_SSH_KEY_NAME" --firewall "$FIREWALL_NAME" --label mawareeth_host_baseline=1 >/dev/null
fi
hcloud server enable-protection "$SERVER_NAME" delete >/dev/null
server_json="$(hcloud server describe "$SERVER_NAME" --output json)"
server_id="$(jq -r '.server.id' <<<"$server_json")"
firewall_json="$(hcloud firewall describe "$FIREWALL_NAME" --output json)"
if ! jq -e --arg server_id "$server_id" '.firewall.applied_to[]? | select(.type == "server" and (.server.id | tostring) == $server_id)' <<<"$firewall_json" >/dev/null; then
  hcloud firewall apply-to-resource "$FIREWALL_NAME" --type server --server "$SERVER_NAME" >/dev/null
fi

server_ip="$(hcloud server ip "$SERVER_NAME")"
[[ -n "$server_ip" ]] || die 'could not determine server address'
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ssh_opts=(-i "$ADMIN_SSH_PRIVATE_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
remote_user="$ADMIN_USER"
if ! ssh "${ssh_opts[@]}" "$remote_user@${server_ip}" true >/dev/null 2>&1; then remote_user=root; fi
scp "${ssh_opts[@]}" "$script_dir/bootstrap-host.sh" "$remote_user@${server_ip}:/tmp/mawareeth-bootstrap-host.sh"
bootstrap_cmd="SSH_ALLOWED_CIDRS=$(printf %q "$SSH_ALLOWED_CIDRS") ADMIN_USER=$(printf %q "$ADMIN_USER") ADMIN_PUBLIC_KEY=$(printf %q "$configured_key") bash /tmp/mawareeth-bootstrap-host.sh"
if [[ "$remote_user" != root ]]; then bootstrap_cmd="sudo $bootstrap_cmd"; fi
ssh "${ssh_opts[@]}" "$remote_user@${server_ip}" "$bootstrap_cmd"
ssh "${ssh_opts[@]}" "$ADMIN_USER@${server_ip}" 'sudo rm -f /tmp/mawareeth-bootstrap-host.sh'
printf '%s\n' 'Provisioning reconciliation completed.'
