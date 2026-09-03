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
    python3 - "$cidr" <<'PY' || die 'SSH_ALLOWED_CIDRS contains an invalid CIDR'
import ipaddress
import sys
ipaddress.ip_network(sys.argv[1], strict=False)
PY
  done
}

[[ ${EUID:-999} -eq 0 ]] || die 'must run as root'
[[ -r /etc/os-release ]] || die 'cannot determine operating system'
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || die 'Ubuntu 24.04 is required'
require_command apt-get
require_command python3
require_command stat
validate_cidrs
ADMIN_USER="${ADMIN_USER:-}" 
ADMIN_PUBLIC_KEY="${ADMIN_PUBLIC_KEY:-}"
[[ "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die 'ADMIN_USER is required and must be valid'
[[ "$ADMIN_PUBLIC_KEY" == ssh-*' '* ]] || die 'ADMIN_PUBLIC_KEY is required'
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

# Docker manipulates iptables after UFW. Keep future published container ports
# private except for the intended web edge, while retaining established traffic.
cat > /usr/local/sbin/mawareeth-docker-firewall <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
iptables -N DOCKER-USER 2>/dev/null || true
iptables -C DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 1 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -C DOCKER-USER -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER 2 -p tcp -m multiport --dports 80,443 -j ACCEPT
iptables -C DOCKER-USER -j DROP 2>/dev/null || iptables -A DOCKER-USER -j DROP
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
install -d -o "$ADMIN_USER" -g "$ADMIN_USER" -m 0700 "/home/$ADMIN_USER/.ssh"
printf '%s\n' "$ADMIN_PUBLIC_KEY" > "/home/$ADMIN_USER/.ssh/authorized_keys"
chown "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh/authorized_keys"
chmod 0600 "/home/$ADMIN_USER/.ssh/authorized_keys"
printf '%s ALL=(ALL) NOPASSWD: ALL\n' "$ADMIN_USER" > "/etc/sudoers.d/90-$ADMIN_USER"
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

# Reset removes any pre-existing unmanaged allow rule, including app/database ports.
# The cloud firewall is already restricted before this guest baseline is reached.
ufw --force reset
ufw --force default deny incoming
ufw --force default allow outgoing
ufw --force delete allow 22/tcp >/dev/null 2>&1 || true
ufw --force delete allow 80/tcp >/dev/null 2>&1 || true
ufw --force delete allow 443/tcp >/dev/null 2>&1 || true
IFS=',' read -r -a cidrs <<<"$SSH_ALLOWED_CIDRS"
for cidr in "${cidrs[@]}"; do ufw allow from "$cidr" to any port 22 proto tcp; done
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

install -d -o root -g root -m 0700 /etc/mawareeth
if [[ -e /etc/mawareeth/runtime.env ]]; then
  :
else
  install -o root -g root -m 0600 /dev/null /etc/mawareeth/runtime.env
fi
printf '%s\n' 'Host baseline complete. Add runtime secrets out of band to /etc/mawareeth/runtime.env.'
