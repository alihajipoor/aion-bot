#!/usr/bin/env bash
# First-time VPS provisioning. Idempotent — safe to re-run.
set -euo pipefail

APP_DIR=/opt/aion
USER=aionbot

id -u "$USER" &>/dev/null || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$USER"
mkdir -p "$APP_DIR"
chown -R "$USER:$USER" "$APP_DIR"

# Swap: a 1.9 GB box with no swap dies on any spike.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

command -v psql >/dev/null || {
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
}

install -m 644 "$APP_DIR/deploy/systemd/aion-bot.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable aion-bot

echo "Provisioned. Put secrets in $APP_DIR/.env (chmod 600), then: systemctl start aion-bot"
