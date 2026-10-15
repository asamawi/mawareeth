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

[[ ${EUID:-999} -eq 0 ]] || die 'must run as root'
[[ -r /etc/os-release ]] || die 'cannot determine operating system'
# shellcheck source=/dev/null # host OS metadata, read at runtime only.
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || die 'Ubuntu 24.04 is required'
require_command apt-get
require_command python3
require_command stat
validate_cidrs
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

# Docker manipulates iptables (and, if Docker's own IPv6 support is ever enabled,
# ip6tables) after UFW. Keep future published container ports private except for
# the intended web edge, while retaining established traffic, on both families.
cat > /usr/local/sbin/mawareeth-docker-firewall <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
restrict() {
  local bin="$1"
  command -v "$bin" >/dev/null 2>&1 || return 0
  "$bin" -N DOCKER-USER 2>/dev/null || true
  "$bin" -C DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || "$bin" -I DOCKER-USER 1 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
  "$bin" -C DOCKER-USER -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null || "$bin" -I DOCKER-USER 2 -p tcp -m multiport --dports 80,443 -j ACCEPT
  "$bin" -C DOCKER-USER -j DROP 2>/dev/null || "$bin" -A DOCKER-USER -j DROP
}
restrict iptables
restrict ip6tables
EOF
chmod 0700 /usr/local/sbin/mawareeth-docker-firewall
cat > /etc/systemd/system/mawareeth-docker-firewall.service <<'EOF'
[Unit]
Description=Restrict externally published Docker ports
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/mawareeth-docker-firewall
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now mawareeth-docker-firewall.service

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
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
trap - ERR

install -d -o root -g root -m 0700 /etc/mawareeth
if [[ -e /etc/mawareeth/runtime.env ]]; then
  :
else
  install -o root -g root -m 0600 /dev/null /etc/mawareeth/runtime.env
fi
printf '%s\n' 'Host baseline complete. Add runtime secrets out of band to /etc/mawareeth/runtime.env.'
