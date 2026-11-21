#!/usr/bin/env bash
# Operator-only Hetzner reconciliation. Never run this from CI.
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

die() { printf 'provision: %s\n' "$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"; }
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
config_file="${HOST_BASELINE_CONFIG:-$script_dir/host-baseline.env}"
[[ -f "$config_file" ]] || die 'operator configuration is required; copy deploy/host-baseline.env.example outside version control'
# Portable (GNU/BSD/macOS) ownership+mode check via python3, already a required dependency.
python3 - "$config_file" "$(id -un)" <<'PY' || die 'operator configuration must be owned by the invoking user and mode 0600'
import os
import pwd
import sys
path, expected_user = sys.argv[1], sys.argv[2]
st = os.stat(path)
mode = oct(st.st_mode & 0o777)[2:].zfill(3)
owner = pwd.getpwuid(st.st_uid).pw_name
if owner != expected_user or mode != '600':
    sys.exit(1)
PY
# shellcheck disable=SC1090
source "$config_file"

validate_cidrs() {
  [[ -n "${SSH_ALLOWED_CIDRS:-}" ]] || die 'SSH_ALLOWED_CIDRS is required'
  local cidr
  # Checked on the raw value: read -a drops a trailing empty field and a
  # here-string read stops at the first newline.
  [[ "$SSH_ALLOWED_CIDRS" != *[[:space:]]* ]] || die 'SSH_ALLOWED_CIDRS must be a comma-separated list without spaces or newlines'
  [[ "$SSH_ALLOWED_CIDRS" != ,* && "$SSH_ALLOWED_CIDRS" != *, ]] || die 'SSH_ALLOWED_CIDRS contains an empty CIDR'
  IFS=',' read -r -a cidrs <<<"$SSH_ALLOWED_CIDRS"
  ((${#cidrs[@]} > 0)) || die 'SSH_ALLOWED_CIDRS must contain at least one CIDR'
  for cidr in "${cidrs[@]}"; do
    [[ -n "$cidr" ]] || die 'SSH_ALLOWED_CIDRS contains an empty CIDR'
    python3 - "$cidr" <<'PY' || die 'SSH_ALLOWED_CIDRS contains an invalid or excessively broad CIDR'
import ipaddress
import sys
net = ipaddress.ip_network(sys.argv[1], strict=False)
min_prefix = 8 if net.version == 4 else 32
if net.prefixlen < min_prefix:
    sys.exit(1)
PY
  done
}

# Public web (80/443) sources: "any" (default, also when empty) keeps the web
# open to every address; "cloudflare" limits it to deploy/cloudflare-ips.txt in
# the Hetzner firewall, DOCKER-USER and UFW. Sets web_sources_json (Hetzner
# source_ips) and web_ranges (comma list for bootstrap, empty for "any").
validate_web_sources() {
  PUBLIC_WEB_SOURCES="${PUBLIC_WEB_SOURCES:-any}"
  web_ranges=''
  case "$PUBLIC_WEB_SOURCES" in
    any) web_sources_json='["0.0.0.0/0", "::/0"]'; return 0 ;;
    cloudflare) ;;
    *) die 'PUBLIC_WEB_SOURCES must be any or cloudflare' ;;
  esac
  local ranges_file="$script_dir/cloudflare-ips.txt" status=0
  [[ -f "$ranges_file" && -r "$ranges_file" ]] || die 'deploy/cloudflare-ips.txt is missing or unreadable'
  web_ranges="$(python3 - "$ranges_file" <<'PY'
import ipaddress
import sys
try:
    with open(sys.argv[1], encoding='ascii') as handle:
        lines = handle.read().splitlines()
except (OSError, UnicodeDecodeError):
    sys.exit(2)
v4, v6, seen = [], [], set()
for raw in lines:
    line = raw.split('#', 1)[0].strip()
    if not line:
        continue
    if len(line.split()) != 1:
        sys.exit(7)
    try:
        if '/' not in line:
            raise ValueError
        net = ipaddress.ip_network(line, strict=True)
    except ValueError:
        sys.exit(3)
    # Catch-all (0.0.0.0/0, ::/0) and over-broad ranges are never Cloudflare's.
    if net.prefixlen < (8 if net.version == 4 else 12):
        sys.exit(4)
    if net in seen:
        sys.exit(5)
    seen.add(net)
    (v4 if net.version == 4 else v6).append(str(net))
if not v4 or not v6:
    sys.exit(6)
print(','.join(v4 + v6))
PY
)" || status=$?
  case "$status" in
    0) ;;
    3) die 'deploy/cloudflare-ips.txt contains an invalid CIDR' ;;
    4) die 'deploy/cloudflare-ips.txt contains a catch-all or excessively broad range' ;;
    5) die 'deploy/cloudflare-ips.txt contains a duplicate range' ;;
    6) die 'deploy/cloudflare-ips.txt must list both IPv4 and IPv6 ranges' ;;
    7) die 'deploy/cloudflare-ips.txt must hold one range per line' ;;
    *) die 'deploy/cloudflare-ips.txt could not be read' ;;
  esac
  web_sources_json="$(python3 -c 'import json, sys; print(json.dumps(sys.argv[1].split(",")))' "$web_ranges")"
}

for required in HETZNER_TOKEN SERVER_NAME HETZNER_SSH_KEY_NAME SSH_PUBLIC_KEY ADMIN_SSH_PRIVATE_KEY SSH_ALLOWED_CIDRS; do
  [[ -n "${!required:-}" ]] || die "$required is required"
done
[[ -r "$SSH_PUBLIC_KEY" ]] || die 'SSH_PUBLIC_KEY must name a readable public-key file'
# A key file must be a regular file whose mode has none of the forbidden bits set.
mode_clear() { # path forbidden-octal-bits
  python3 - "$1" "$2" <<'PY'
import os
import stat
import sys
st = os.stat(sys.argv[1])
if not stat.S_ISREG(st.st_mode) or st.st_mode & int(sys.argv[2], 8):
    sys.exit(1)
PY
}
mode_clear "$SSH_PUBLIC_KEY" 022 || die 'SSH_PUBLIC_KEY must be a regular file not writable by group or others'
[[ "$(grep -c '[^[:space:]]' "$SSH_PUBLIC_KEY")" -eq 1 ]] || die 'SSH_PUBLIC_KEY must contain exactly one key on a single line'
[[ -r "$ADMIN_SSH_PRIVATE_KEY" ]] || die 'ADMIN_SSH_PRIVATE_KEY must name a readable private-key file'
mode_clear "$ADMIN_SSH_PRIVATE_KEY" 077 || die 'ADMIN_SSH_PRIVATE_KEY must be a regular file not accessible by group or others (chmod 600)'
[[ "$SERVER_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$ ]] || die 'SERVER_NAME is invalid'
[[ "$HETZNER_SSH_KEY_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$ ]] || die 'HETZNER_SSH_KEY_NAME is invalid'
# hcloud resolves a numeric argument as an ID first, so names must never be all digits.
[[ ! "$SERVER_NAME" =~ ^[0-9]+$ ]] || die 'SERVER_NAME must not be all digits (hcloud reads a number as an ID)'
[[ ! "$HETZNER_SSH_KEY_NAME" =~ ^[0-9]+$ ]] || die 'HETZNER_SSH_KEY_NAME must not be all digits (hcloud reads a number as an ID)'
require_command python3
validate_cidrs
validate_web_sources
require_command hcloud
require_command jq
require_command curl
require_command ssh
require_command scp
require_command ssh-keygen
export HCLOUD_TOKEN="$HETZNER_TOKEN"
FIREWALL_NAME="${FIREWALL_NAME:-${SERVER_NAME}-edge}"
[[ "$FIREWALL_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$ ]] || die 'FIREWALL_NAME is invalid'
[[ ! "$FIREWALL_NAME" =~ ^[0-9]+$ ]] || die 'FIREWALL_NAME must not be all digits (hcloud reads a number as an ID)'
ADMIN_USER="${ADMIN_USER:-mawareeth-admin}"
[[ "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die 'ADMIN_USER is invalid'

configured_key="$(tr -d '\r\n' < "$SSH_PUBLIC_KEY")"
# An empty passphrase and no stdin keep an encrypted key from waiting at a prompt;
# ssh-keygen then reports "incorrect passphrase", which gets its own refusal.
keygen_err="$(mktemp)"
if ! private_key="$(LC_ALL=C ssh-keygen -y -P '' -f "$ADMIN_SSH_PRIVATE_KEY" 2>"$keygen_err" </dev/null)"; then
  keygen_msg="$(cat "$keygen_err")"
  rm -f "$keygen_err"
  if [[ "$keygen_msg" == *'incorrect passphrase'* ]]; then
    die 'ADMIN_SSH_PRIVATE_KEY is passphrase-protected; provisioning needs a key usable without a prompt'
  fi
  die 'ADMIN_SSH_PRIVATE_KEY is not a usable private key'
fi
rm -f "$keygen_err"
# Compare only the key type and base64 data; ssh-keygen -y echoes back whatever
# comment is embedded in the private key (notably always for ed25519), so
# comparing full lines or assuming one side is bare produces false mismatches.
IFS=' ' read -r configured_type configured_data _ <<<"$configured_key"
IFS=' ' read -r private_type private_data _ <<<"$private_key"
[[ -n "$configured_type" && -n "$configured_data" ]] || die 'SSH_PUBLIC_KEY must contain a key type and base64 key data'
[[ "$configured_type $configured_data" == "$private_type $private_data" ]] || die 'configured public and private SSH keys do not match'

# Look up the server, SSH key and firewall by exact name with `list`, before any
# provider change. A failed lookup (auth, network, rate limit) must never read as
# "absent": only a successful array without a match means the resource is missing.
# Sets lookup_json to the single matching object, or to '' when there is none.
lookup_by_name() { # label resource name
  local label="$1" resource="$2" name="$3" listing matches count
  local failure="could not look up Hetzner $label \"$name\"; check HETZNER_TOKEN and connectivity"
  listing="$(hcloud "$resource" list -o json 2>/dev/null </dev/null)" || die "$failure"
  matches="$(jq -c --arg name "$name" 'if . == null then [] elif type == "array" then map(select(.name == $name)) else error("not an array") end' <<<"$listing" 2>/dev/null)" || die "$failure"
  [[ -n "$matches" ]] || die "$failure"
  count="$(jq 'length' <<<"$matches")"
  case "$count" in
    0) lookup_json='' ;;
    1) lookup_json="$(jq -c '.[0]' <<<"$matches")" ;;
    *) die "Hetzner $label \"$name\" is ambiguous (more than one match); operator decision required" ;;
  esac
}
# True when every attachment of the firewall is the server with this id; a label
# selector counts as another attachment even if it matches only this host today.
firewall_only_on_server() { # server-id firewall-json
  jq -e --arg server_id "$1" 'all((.firewall // .).applied_to[]?; .type == "server" and (.server.id | tostring) == $server_id)' <<<"$2" >/dev/null
}
lookup_by_name server server "$SERVER_NAME"
server_json="$lookup_json"
lookup_by_name 'SSH key' ssh-key "$HETZNER_SSH_KEY_NAME"
key_json="$lookup_json"
lookup_by_name firewall firewall "$FIREWALL_NAME"
firewall_json="$lookup_json"

# Inspect an existing host before changing any provider resource. A matching name
# must be explicitly labelled as a baseline host before this script may reconcile it.
server_exists=false
if [[ -n "$server_json" ]]; then
  server_exists=true
  type="$(jq -r '.server_type.name' <<<"$server_json")"
  # Current releases report .location; older ones only .datacenter.location.
  location="$(jq -r '.location.name // .datacenter.location.name' <<<"$server_json")"
  image="$(jq -r '.image.name' <<<"$server_json")"
  managed="$(jq -r '.labels.mawareeth_host_baseline // empty' <<<"$server_json")"
  existing_server_id="$(jq -r '.id' <<<"$server_json")"
  [[ "$type" == cx33 && "$location" == nbg1 && "$image" == ubuntu-24.04 && "$managed" == 1 ]] || die 'existing server is conflicting or not managed by this baseline; operator decision required'
fi

# A named key is reused; a different public key under the same identity is an operator decision.
if [[ -n "$key_json" ]]; then
  existing_key="$(jq -r '.public_key' <<<"$key_json")"
  # Compare only type and base64 data, matching the private-key comparison above:
  # Hetzner may normalize or drop the comment, producing a false mismatch otherwise.
  IFS=' ' read -r existing_type existing_data _ <<<"$existing_key"
  [[ "$configured_type $configured_data" == "$existing_type $existing_data" ]] || die 'existing SSH-key identity has different public key; operator decision required'
fi

# An existing firewall must belong to this host alone, whatever way it is attached.
if [[ -n "$firewall_json" ]]; then
  if [[ "$server_exists" == false ]] && ! firewall_only_on_server none "$firewall_json"; then
    die 'configured firewall is already attached to another server; operator decision required'
  fi
  if [[ "$server_exists" == true ]] && ! firewall_only_on_server "$existing_server_id" "$firewall_json"; then
    die 'configured firewall is shared with another server; operator decision required'
  fi
fi

# Every refusal above happens before the first provider change below.
if [[ -z "$key_json" ]]; then
  hcloud ssh-key create --name "$HETZNER_SSH_KEY_NAME" --public-key-from-file "$SSH_PUBLIC_KEY" >/dev/null
fi
if [[ -z "$firewall_json" ]]; then
  hcloud firewall create --name "$FIREWALL_NAME" >/dev/null
fi

# Replace the rule set atomically: public web only (from everywhere, or only
# from Cloudflare's ranges with PUBLIC_WEB_SOURCES=cloudflare), and SSH only
# from explicit CIDRs.
IFS=',' read -r -a cidrs <<<"$SSH_ALLOWED_CIDRS"
cidr_json="$(printf '%s\n' "${cidrs[@]}" | jq -R . | jq -s .)"
rules_payload="$(jq -n --argjson ssh_sources "$cidr_json" --argjson web_sources "$web_sources_json" '
  {rules: ([
    {direction: "in", protocol: "tcp", port: "80", source_ips: $web_sources},
    {direction: "in", protocol: "tcp", port: "443", source_ips: $web_sources}
  ] + ($ssh_sources | map({direction: "in", protocol: "tcp", port: "22", source_ips: [.]})))}')"
# hcloud --output json returns the bare object in current releases and wrapped it
# in a resource key (.firewall) in older ones; accept both.
firewall_json="$(hcloud firewall describe "$FIREWALL_NAME" --output json)"
if [[ "$server_exists" == true ]]; then
  firewall_only_on_server "$existing_server_id" "$firewall_json" || die 'configured firewall is shared with another server; operator decision required'
else
  firewall_only_on_server none "$firewall_json" || die 'configured firewall is already attached to another server; operator decision required'
fi
firewall_id="$(jq -r '(.firewall // .).id' <<<"$firewall_json")"
[[ "$firewall_id" =~ ^[0-9]+$ ]] || die 'could not determine the firewall id'
# Pass the bearer token via a curl config file rather than argv, so it is not
# visible to other processes on this workstation through `ps`/`/proc`.
curl_auth_config="$(mktemp)"
trap 'rm -f "$curl_auth_config"' EXIT
printf 'header = "Authorization: Bearer %s"\n' "$HETZNER_TOKEN" > "$curl_auth_config"
chmod 600 "$curl_auth_config"
action_json="$(curl --fail --silent --show-error --request POST \
  --config "$curl_auth_config" \
  --connect-timeout 10 --max-time 30 \
  --header 'Content-Type: application/json' \
  --data "$rules_payload" \
  "https://api.hetzner.cloud/v1/firewalls/${firewall_id}/actions/set_rules")"
rm -f "$curl_auth_config"
trap - EXIT
# set_rules answers with an actions array (the rule change plus one apply per
# attached resource); an older single action is accepted too.
action_ids="$(jq -r '[.actions[]?.id, .action.id?] | map(select(. != null)) | .[]' <<<"$action_json")"
[[ -n "$action_ids" ]] || die 'firewall rule update did not return an action id'
while IFS= read -r action_id; do
  [[ "$action_id" =~ ^[0-9]+$ ]] || die 'firewall rule update returned an invalid action id'
  hcloud action wait "$action_id" >/dev/null
done <<<"$action_ids"

if [[ "$server_exists" == false ]]; then
  hcloud server create --name "$SERVER_NAME" --type cx33 --location nbg1 --image ubuntu-24.04 --ssh-key "$HETZNER_SSH_KEY_NAME" --firewall "$FIREWALL_NAME" --label mawareeth_host_baseline=1 >/dev/null
fi
# The API requires delete and rebuild protection to be set together.
hcloud server enable-protection "$SERVER_NAME" delete rebuild >/dev/null
server_json="$(hcloud server describe "$SERVER_NAME" --output json)"
server_id="$(jq -r '(.server // .).id' <<<"$server_json")"
firewall_json="$(hcloud firewall describe "$FIREWALL_NAME" --output json)"
# The firewall may have gained a selector or another server since the lookup.
firewall_only_on_server "$server_id" "$firewall_json" || die 'configured firewall is shared with another server; operator decision required'
if ! jq -e --arg server_id "$server_id" '(.firewall // .).applied_to[]? | select(.type == "server" and (.server.id | tostring) == $server_id)' <<<"$firewall_json" >/dev/null; then
  hcloud firewall apply-to-resource "$FIREWALL_NAME" --type server --server "$SERVER_NAME" >/dev/null
fi

server_ip="$(hcloud server ip "$SERVER_NAME")"
[[ -n "$server_ip" ]] || die 'could not determine server address'
ssh_opts=(-i "$ADMIN_SSH_PRIVATE_KEY" -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)
# A freshly created host needs time to finish booting before sshd answers;
# poll both accounts for up to five minutes before giving up.
remote_user=""
for _attempt in $(seq 1 30); do
  if ssh "${ssh_opts[@]}" "$ADMIN_USER@${server_ip}" true >/dev/null 2>&1; then remote_user="$ADMIN_USER"; break; fi
  if ssh "${ssh_opts[@]}" "root@${server_ip}" true >/dev/null 2>&1; then remote_user=root; break; fi
  sleep 10
done
[[ -n "$remote_user" ]] || die "timed out waiting for SSH to become reachable on ${server_ip} as ${ADMIN_USER} or root after 5 minutes; check that the host finished booting, that this workstation's address is included in SSH_ALLOWED_CIDRS, and that the Hetzner firewall/network path to ${server_ip}:22 is reachable"
scp "${ssh_opts[@]}" "$script_dir/bootstrap-host.sh" "$remote_user@${server_ip}:/tmp/mawareeth-bootstrap-host.sh"
web_env="PUBLIC_WEB_SOURCES=$(printf %q "$PUBLIC_WEB_SOURCES")"
if [[ -n "$web_ranges" ]]; then web_env="$web_env PUBLIC_WEB_RANGES=$(printf %q "$web_ranges")"; fi
bootstrap_cmd="SSH_ALLOWED_CIDRS=$(printf %q "$SSH_ALLOWED_CIDRS") ADMIN_USER=$(printf %q "$ADMIN_USER") ADMIN_PUBLIC_KEY=$(printf %q "$configured_key") $web_env bash /tmp/mawareeth-bootstrap-host.sh"
if [[ "$remote_user" != root ]]; then bootstrap_cmd="sudo $bootstrap_cmd"; fi
# shellcheck disable=SC2029 # bootstrap_cmd is %q-quoted here and must expand client-side.
ssh "${ssh_opts[@]}" "$remote_user@${server_ip}" "$bootstrap_cmd"
ssh "${ssh_opts[@]}" "$ADMIN_USER@${server_ip}" 'sudo rm -f /tmp/mawareeth-bootstrap-host.sh' || true
printf '%s\n' 'Provisioning reconciliation completed.'
