#!/usr/bin/env bash
# One-time VPS preparation (Debian/Ubuntu, run as root): Docker Engine + compose plugin, ufw 22/80/443,
# swap, the Docker volumes, private secrets dir and the healthcheck cron.
#   sudo STAMPER_USER=deploy infra/scripts/vps-bootstrap.sh [--dry-run]
# Then: cp infra/.env.example infra/.env (COMPOSE_PROFILES=prod), fill infra/secrets/, and
#   docker compose -f infra/docker-compose.yml up -d
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1
run() { if [[ $DRY -eq 1 ]]; then printf '+ %s\n' "$*"; else "$@"; fi; }
SWAP_GB="${SWAP_GB:-4}"
STAMPER_USER="${STAMPER_USER:-${SUDO_USER:-root}}"
[[ "$SWAP_GB" =~ ^[0-9]+$ ]] || die "SWAP_GB must be an integer"
[[ $DRY -eq 1 || $EUID -eq 0 ]] || die "run as root (or --dry-run)"
[[ -r /etc/os-release ]] || die "unsupported OS"
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == debian || "${ID:-}" == ubuntu ]] || die "only Debian/Ubuntu are supported (found ${ID:-?})"

log "packages"
run apt-get update -q
run apt-get install -y -q ca-certificates curl gnupg ufw cron
if ! command -v docker >/dev/null 2>&1; then
  log "Docker Engine + compose plugin (official apt repository)"
  run install -m 0755 -d /etc/apt/keyrings
  run curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  run chmod a+r /etc/apt/keyrings/docker.asc
  line="deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME:-stable} stable"
  if [[ $DRY -eq 1 ]]; then echo "+ echo '$line' > /etc/apt/sources.list.d/docker.list"; else echo "$line" >/etc/apt/sources.list.d/docker.list; fi
  run apt-get update -q
  run apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
run systemctl enable --now docker
[[ "$STAMPER_USER" == root ]] || run usermod -aG docker "$STAMPER_USER"

log "firewall: 22, 80, 443 (tcp) and 443/udp (HTTP/3)"
run ufw default deny incoming
run ufw default allow outgoing
run ufw allow 22/tcp
run ufw allow 80/tcp
run ufw allow 443/tcp
run ufw allow 443/udp
run ufw --force enable

if [[ "$SWAP_GB" -gt 0 ]] && ! swapon --show=NAME --noheadings | grep -q .; then
  log "swap ${SWAP_GB} GB"
  run fallocate -l "${SWAP_GB}G" /swapfile
  run chmod 600 /swapfile
  run mkswap /swapfile
  run swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || run sh -c 'echo "/swapfile none swap sw 0 0" >> /etc/fstab'
  run sysctl -w vm.swappiness=10
fi

log "volumes and secrets directory"
for v in staging cache models pg pgdump caddy; do run docker volume create "stamper_${v}" >/dev/null; done
run install -d -m 700 -o "$STAMPER_USER" "${INFRA_DIR}/secrets"
run install -d -m 700 -o "$STAMPER_USER" "${INFRA_DIR}/env"

log "healthcheck cron (every 5 min)"
cron="*/5 * * * * ${STAMPER_USER} ${INFRA_DIR}/scripts/healthcheck.sh >/dev/null 2>&1"
if [[ $DRY -eq 1 ]]; then echo "+ echo '$cron' > /etc/cron.d/stamper-healthcheck"; else
  printf 'SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n%s\n' "$cron" >/etc/cron.d/stamper-healthcheck
  chmod 644 /etc/cron.d/stamper-healthcheck
fi
log "done. Next: infra/.env + infra/secrets/* then 'docker compose -f infra/docker-compose.yml up -d'"
