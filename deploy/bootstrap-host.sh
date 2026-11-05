#!/usr/bin/env bash
# Guest-only Ubuntu 24.04 baseline. Run as root via provision-host.sh.
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

die() { printf 'bootstrap: %s\n' "$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"; }

validate_cidrs() {
  [[ -n "${SSH_ALLOWED_CIDRS:-}" ]] || die 'SSH_ALLOWED_CIDRS is required'
  local cidr
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

# >>> public web sources (deploy/tests/test_host_baseline.sh extracts this block)
# PUBLIC_WEB_SOURCES selects who may reach 80/443: "any" or "cloudflare", whose
# ranges provision-host.sh passes from deploy/cloudflare-ips.txt in
# PUBLIC_WEB_RANGES. The effective choice is persisted, and a run without
# PUBLIC_WEB_SOURCES keeps it (a fresh host defaults to "any"); an explicit
# value always wins. The path overrides are for the offline tests only.
web_state_file="${MAWAREETH_PUBLIC_WEB_STATE:-/etc/mawareeth/public-web-sources}"
ufw_defaults_file="${MAWAREETH_UFW_DEFAULTS:-/etc/default/ufw}"

load_persisted_web_sources() {
  PUBLIC_WEB_SOURCES=any
  PUBLIC_WEB_RANGES=''
  [[ -e "$web_state_file" || -L "$web_state_file" ]] || return 0
  [[ -f "$web_state_file" && ! -L "$web_state_file" ]] || die "$web_state_file must be a regular file"
  [[ "$(stat -c '%u:%a' "$web_state_file")" == "${EUID}:644" ]] || die "refusing unsafe ownership or mode on $web_state_file"
  local key value
  while IFS='=' read -r key value; do
    case "$key" in
      PUBLIC_WEB_SOURCES) PUBLIC_WEB_SOURCES="$value" ;;
      PUBLIC_WEB_RANGES) PUBLIC_WEB_RANGES="$value" ;;
      *) die "$web_state_file holds an unexpected line" ;;
    esac
  done < "$web_state_file"
}

# Sets PUBLIC_WEB_SOURCES, PUBLIC_WEB_RANGES, web_v4 and web_v6.
validate_web_sources() {
  if [[ -z "${PUBLIC_WEB_SOURCES+set}" ]]; then
    [[ -z "${PUBLIC_WEB_RANGES:-}" ]] || die 'PUBLIC_WEB_RANGES requires an explicit PUBLIC_WEB_SOURCES'
    load_persisted_web_sources
  fi
  PUBLIC_WEB_SOURCES="${PUBLIC_WEB_SOURCES:-any}"
  PUBLIC_WEB_RANGES="${PUBLIC_WEB_RANGES:-}"
  web_v4=()
  web_v6=()
  case "$PUBLIC_WEB_SOURCES" in
    any)
      [[ -z "$PUBLIC_WEB_RANGES" ]] || die 'PUBLIC_WEB_RANGES is only valid with PUBLIC_WEB_SOURCES=cloudflare'
      return 0 ;;
    cloudflare) ;;
    *) die 'PUBLIC_WEB_SOURCES must be any or cloudflare' ;;
  esac
  [[ -n "$PUBLIC_WEB_RANGES" ]] || die 'PUBLIC_WEB_RANGES (from deploy/cloudflare-ips.txt) is required with PUBLIC_WEB_SOURCES=cloudflare'
  local classified family range
  # Ranges must be canonical (as iptables -S prints them), so the rules can be
  # matched, pruned and verified later.
  classified="$(python3 - "$PUBLIC_WEB_RANGES" <<'PY'
import ipaddress
import sys
seen, families = set(), set()
for item in sys.argv[1].split(','):
    try:
        if '/' not in item:
            raise ValueError
        net = ipaddress.ip_network(item, strict=True)
    except ValueError:
        sys.exit(1)
    if str(net) != item or net in seen or net.prefixlen < (8 if net.version == 4 else 12):
        sys.exit(1)
    seen.add(net)
    families.add(net.version)
    print(net.version, net)
if families != {4, 6}:
    sys.exit(1)
PY
)" || die 'PUBLIC_WEB_RANGES (from deploy/cloudflare-ips.txt) has an invalid, duplicate, or over-broad range, or lacks IPv4 or IPv6 ranges'
  while IFS=' ' read -r family range; do
    if [[ "$family" == 4 ]]; then web_v4+=("$range"); else web_v6+=("$range"); fi
  done <<<"$classified"
}

# Writes the effective choice for the next run without PUBLIC_WEB_SOURCES.
persist_web_sources() {
  local staged="$web_state_file.new"
  rm -f -- "$staged"
  printf 'PUBLIC_WEB_SOURCES=%s\nPUBLIC_WEB_RANGES=%s\n' "$PUBLIC_WEB_SOURCES" "$PUBLIC_WEB_RANGES" > "$staged"
  chmod 0644 "$staged"
  mv -f -- "$staged" "$web_state_file"
}

# Without IPV6=yes UFW leaves IPv6 unfiltered, and docker-proxy accepts IPv6
# web connections, so the lock would not hold for IPv6.
require_ufw_ipv6() {
  [[ "$PUBLIC_WEB_SOURCES" == cloudflare ]] || return 0
  grep -qx 'IPV6=yes' "$ufw_defaults_file" 2>/dev/null \
    || die "PUBLIC_WEB_SOURCES=cloudflare requires IPV6=yes in $ufw_defaults_file"
}

# 80/443 accept rules in DOCKER-USER, as "<source or -> <rule spec>" lines, and
# their pruning. Bootstrap uses them, and the cloudflare-mode firewall script
# carries the same text, so every Docker start converges the chain.
IFS= read -r -d '' web_accept_functions <<'EOF' || true
web_accept_rules() {
  local rule source
  while IFS= read -r rule; do
    [[ "$rule" == '-A DOCKER-USER '* && "$rule" == *' --dports 80,443 '* && "$rule" == *' -j ACCEPT' ]] || continue
    source=-
    if [[ "$rule" =~ \ -s\ ([^ ]+) ]]; then source="${BASH_REMATCH[1]}"; fi
    printf '%s %s\n' "$source" "${rule#-A DOCKER-USER }"
  done < <("$1" -S DOCKER-USER 2>/dev/null || true)
}
# prune_web_accepts BIN keep|drop SOURCE...: delete every 80/443 accept whose
# source is not listed; keep or drop the unsourced one.
prune_web_accepts() {
  local bin="$1" unsourced="$2" source spec_text wanted keep
  shift 2
  local -a stale=() spec
  while IFS=' ' read -r source spec_text; do
    keep=false
    if [[ "$source" == - ]]; then
      if [[ "$unsourced" == keep ]]; then keep=true; fi
    else
      for wanted in "$@"; do
        if [[ "$source" == "$wanted" ]]; then keep=true; fi
      done
    fi
    if [[ "$keep" == false ]]; then stale+=("$spec_text"); fi
  done < <(web_accept_rules "$bin")
  for spec_text in "${stale[@]}"; do
    IFS=' ' read -r -a spec <<<"$spec_text"
    "$bin" -D DOCKER-USER "${spec[@]}"
  done
}
EOF
eval "$web_accept_functions"

# Prints /usr/local/sbin/mawareeth-docker-firewall. Docker manipulates iptables
# (and, if Docker's own IPv6 support is ever enabled, ip6tables) after UFW. Keep
# future published container ports private except for the intended web edge,
# while retaining established traffic, on both families. The chosen ranges are
# baked in because the script runs at every Docker start.
docker_firewall_script() {
  if [[ "$PUBLIC_WEB_SOURCES" == any ]]; then
    cat <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
restrict() {
  local bin="$1"
  command -v "$bin" >/dev/null 2>&1 || return 0
  "$bin" -N DOCKER-USER 2>/dev/null || true
  "$bin" -C DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || "$bin" -I DOCKER-USER 1 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
  "$bin" -C DOCKER-USER -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null || "$bin" -I DOCKER-USER 2 -p tcp -m multiport --dports 80,443 -j ACCEPT
  # Traffic that containers start (DNS, Mailgun, Storage Box, Heroku) leaves
  # through Docker's bridges. RETURN hands it back to Docker's own forwarding
  # and isolation rules; only traffic arriving from outside is limited to 80/443.
  "$bin" -C DOCKER-USER -i docker0 -j RETURN 2>/dev/null || "$bin" -I DOCKER-USER 3 -i docker0 -j RETURN
  "$bin" -C DOCKER-USER -i br-+ -j RETURN 2>/dev/null || "$bin" -I DOCKER-USER 4 -i br-+ -j RETURN
  "$bin" -C DOCKER-USER -j DROP 2>/dev/null || "$bin" -A DOCKER-USER -j DROP
}
restrict iptables
restrict ip6tables
EOF
    return 0
  fi
  cat <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
# PUBLIC_WEB_SOURCES=cloudflare: published web ports accept only Cloudflare's
# ranges (deploy/cloudflare-ips.txt), IPv4 in iptables and IPv6 in ip6tables.
EOF
  printf '%s' "$web_accept_functions"
  cat <<'EOF'
restrict() {
  local bin="$1"
  shift
  command -v "$bin" >/dev/null 2>&1 || return 0
  "$bin" -N DOCKER-USER 2>/dev/null || true
  "$bin" -C DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || "$bin" -I DOCKER-USER 1 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
  # Ranges no longer listed go first, so the kept ones stay in list order and
  # each missing one is inserted at its own position.
  prune_web_accepts "$bin" keep "$@"
  local position=2 source
  for source in "$@"; do
    "$bin" -C DOCKER-USER -s "$source" -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null || "$bin" -I DOCKER-USER "$position" -s "$source" -p tcp -m multiport --dports 80,443 -j ACCEPT
    position=$((position + 1))
  done
  # The unsourced accept of PUBLIC_WEB_SOURCES=any goes last, once the ranges
  # are in place, so the web never closes during a switch.
  prune_web_accepts "$bin" drop "$@"
  # Traffic that containers start (DNS, Mailgun, Storage Box, Heroku) leaves
  # through Docker's bridges. RETURN hands it back to Docker's own forwarding
  # and isolation rules; only traffic arriving from outside is limited to 80/443.
  "$bin" -C DOCKER-USER -i docker0 -j RETURN 2>/dev/null || "$bin" -I DOCKER-USER "$position" -i docker0 -j RETURN
  "$bin" -C DOCKER-USER -i br-+ -j RETURN 2>/dev/null || "$bin" -I DOCKER-USER "$((position + 1))" -i br-+ -j RETURN
  "$bin" -C DOCKER-USER -j DROP 2>/dev/null || "$bin" -A DOCKER-USER -j DROP
}
EOF
  printf 'restrict iptables'
  printf ' %s' "${web_v4[@]}"
  printf '\nrestrict ip6tables'
  printf ' %s' "${web_v6[@]}"
  printf '\n'
}

# Each family's DOCKER-USER must accept 80/443 from exactly the mode's sources:
# the ranges of that family, or one unsourced rule in "any" mode.
verify_web_accepts() { # bin source... ("-" for unsourced)
  local bin="$1" actual expected
  shift
  command -v "$bin" >/dev/null 2>&1 || die "$bin is required to verify DOCKER-USER"
  actual="$(web_accept_rules "$bin" | cut -d ' ' -f 1 | LC_ALL=C sort)"
  expected="$(printf '%s\n' "$@" | LC_ALL=C sort)"
  [[ "$actual" == "$expected" ]] \
    || die "$bin DOCKER-USER does not accept 80/443 from exactly the PUBLIC_WEB_SOURCES=$PUBLIC_WEB_SOURCES sources; inspect '$bin -S DOCKER-USER'"
}
# Runs after the firewall unit: "any" mode's script is today's and only adds
# rules, so remove the ranges a cloudflare run left here; then verify.
converge_docker_web_rules() {
  if [[ "$PUBLIC_WEB_SOURCES" == any ]]; then
    prune_web_accepts iptables keep
    prune_web_accepts ip6tables keep
    verify_web_accepts iptables -
    verify_web_accepts ip6tables -
  else
    verify_web_accepts iptables "${web_v4[@]}"
    verify_web_accepts ip6tables "${web_v6[@]}"
  fi
}

# UFW filters host-delivered traffic, which includes the IPv6 clients that
# docker-proxy accepts for the published ports. Its reset drops stale rules.
allow_public_web() {
  if [[ "$PUBLIC_WEB_SOURCES" == any ]]; then
    ufw allow 80/tcp
    ufw allow 443/tcp
    return 0
  fi
  local range
  for range in "${web_v4[@]}" "${web_v6[@]}"; do
    ufw allow proto tcp from "$range" to any port 80,443
  done
}
# <<< public web sources

[[ ${EUID:-999} -eq 0 ]] || die 'must run as root'
[[ -r /etc/os-release ]] || die 'cannot determine operating system'
# shellcheck source=/dev/null # host OS metadata, read at runtime only.
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || die 'Ubuntu 24.04 is required'
require_command apt-get
require_command python3
require_command stat
validate_cidrs
validate_web_sources
ADMIN_USER="${ADMIN_USER:-}" 
ADMIN_PUBLIC_KEY="${ADMIN_PUBLIC_KEY:-}"
[[ "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die 'ADMIN_USER is required and must be valid'
[[ "$ADMIN_PUBLIC_KEY" =~ ^(ssh-[a-z0-9]+|ecdsa-sha2-[a-z0-9]+|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-[a-z0-9]+@openssh\.com)[[:space:]] ]] || die 'ADMIN_PUBLIC_KEY is required and must be a valid OpenSSH public key'
if [[ -e /etc/mawareeth ]] && [[ "$(stat -c '%U:%G:%a' /etc/mawareeth)" != root:root:700 ]]; then
  die 'refusing unsafe ownership or mode on /etc/mawareeth'
fi
if [[ -e /etc/mawareeth/runtime.env ]] && [[ "$(stat -c '%U:%G:%a' /etc/mawareeth/runtime.env)" != root:root:600 ]]; then
  die 'refusing unsafe ownership or mode on runtime secret file'
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg sudo ufw unattended-upgrades
# Before any firewall change: the Cloudflare lock needs UFW to filter IPv6.
require_ufw_ipv6

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
arch="$(dpkg --print-architecture)"
# shellcheck source=/dev/null # host OS metadata, read at runtime only.
codename="$( . /etc/os-release && printf '%s' "$VERSION_CODENAME" )"
printf '%s\n' "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $codename stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# Security updates are automatic; review their results during the documented weekly maintenance window.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52mawareeth-unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
        "${distro_id}:${distro_codename}-security";
        "${distro_id}ESMApps:${distro_codename}-apps-security";
        "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
EOF
systemctl enable --now unattended-upgrades

docker_firewall_script > /usr/local/sbin/mawareeth-docker-firewall
chmod 0700 /usr/local/sbin/mawareeth-docker-firewall
cat > /etc/systemd/system/mawareeth-docker-firewall.service <<'EOF'
[Unit]
Description=Restrict externally published Docker ports
After=docker.service
BindsTo=docker.service
PartOf=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/mawareeth-docker-firewall
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target docker.service
EOF
systemctl daemon-reload
# reenable refreshes the wants links on hosts bootstrapped before docker.service
# wanted the unit; restart reapplies the (idempotent) rules on a rerun.
systemctl reenable mawareeth-docker-firewall.service
systemctl restart mawareeth-docker-firewall.service
# Fails the run, before UFW changes, unless each family accepts 80/443 from
# exactly the chosen sources.
converge_docker_web_rules

id -u "$ADMIN_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$ADMIN_USER"
admin_home="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"
[[ -n "$admin_home" ]] || die "could not determine home directory for $ADMIN_USER"
install -d -o "$ADMIN_USER" -g "$ADMIN_USER" -m 0700 "$admin_home/.ssh"
printf '%s\n' "$ADMIN_PUBLIC_KEY" > "$admin_home/.ssh/authorized_keys"
chown "$ADMIN_USER:$ADMIN_USER" "$admin_home/.ssh/authorized_keys"
chmod 0600 "$admin_home/.ssh/authorized_keys"
printf '%s ALL=(ALL) NOPASSWD: ALL\nDefaults:%s env_keep += "SSH_ALLOWED_CIDRS ADMIN_USER ADMIN_PUBLIC_KEY"\n' "$ADMIN_USER" "$ADMIN_USER" > "/etc/sudoers.d/90-$ADMIN_USER"
chmod 0440 "/etc/sudoers.d/90-$ADMIN_USER"
visudo -cf "/etc/sudoers.d/90-$ADMIN_USER"

cat > /etc/ssh/sshd_config.d/99-mawareeth-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AuthenticationMethods publickey
EOF
sshd -t
systemctl reload ssh

# Reset clears every pre-existing unmanaged rule, including app/database ports, and
# leaves ufw disabled until the final enable below. The cloud firewall is already
# restricted before this guest baseline is reached, but fail closed here too: if
# anything in this sequence errors, force a deny-all-incoming policy and re-enable
# rather than leaving the guest with no packet filtering at all.
ufw --force reset
ufw_fail_closed() { ufw --force default deny incoming; ufw --force enable; }
trap ufw_fail_closed ERR
ufw --force default deny incoming
ufw --force default allow outgoing
IFS=',' read -r -a cidrs <<<"$SSH_ALLOWED_CIDRS"
for cidr in "${cidrs[@]}"; do ufw allow from "$cidr" to any port 22 proto tcp; done
allow_public_web
ufw --force enable
trap - ERR

# Docker's veth interfaces trigger cloud-init's network hotplug hook when their
# random MAC matches its udev rule. The hook then fails after about 90 seconds,
# because they are not in Hetzner's metadata, which leaves
# cloud-init-hotplugd.service failed. This host's network is configured at boot.
install -d -o root -g root -m 0755 /etc/cloud/cloud.cfg.d
install -o root -g root -m 0644 /dev/null /etc/cloud/cloud.cfg.d/99-mawareeth-no-network-hotplug.cfg
cat > /etc/cloud/cloud.cfg.d/99-mawareeth-no-network-hotplug.cfg <<'CFG'
updates:
  network:
    when: ['boot-new-instance']
CFG

install -d -o root -g root -m 0700 /etc/mawareeth
persist_web_sources
if [[ -e /etc/mawareeth/runtime.env ]]; then
  :
else
  install -o root -g root -m 0600 /dev/null /etc/mawareeth/runtime.env
fi
printf '%s\n' 'Host baseline complete. Add runtime secrets out of band to /etc/mawareeth/runtime.env.'
