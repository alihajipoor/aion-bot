#!/usr/bin/env bash
# Runs ON the VPS. Extracts the bundle, migrates, restarts. Idempotent.
set -euo pipefail

APP=/opt/aion
RELEASES=/opt/aion-releases
BUNDLE=${1:-/tmp/aion.tar.gz}

[ -f "$BUNDLE" ] || { echo "bundle $BUNDLE not found"; exit 1; }

mkdir -p "$APP" "$RELEASES"
id -u aionbot >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin aionbot

# Keep the last 3 releases so a bad deploy can be rolled back by hand.
if [ -d "$APP/apps" ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  cp -a "$APP" "$RELEASES/$STAMP"
  ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
fi

tar xzf "$BUNDLE" -C "$APP"
rm -f "$BUNDLE"

install -m 644 "$APP/deploy/systemd/aion-bot.service" /etc/systemd/system/
[ -f "$APP/deploy/systemd/aion-web.service" ] && install -m 644 "$APP/deploy/systemd/aion-web.service" /etc/systemd/system/
install -m 644 "$APP/deploy/systemd/aion-watchdog.service" /etc/systemd/system/
install -m 644 "$APP/deploy/systemd/aion-watchdog.timer" /etc/systemd/system/
# The bot writes its heartbeat here and the watchdog reads it.
mkdir -p "$APP/run"

# The web bundle ships as webdist/ and is swapped in atomically.
if [ -d "$APP/webdist" ]; then
  rm -rf "$APP/web.old"
  [ -d "$APP/web" ] && mv "$APP/web" "$APP/web.old"
  mv "$APP/webdist" "$APP/web"
  rm -rf "$APP/web.old"
fi
chown -R aionbot:aionbot "$APP"
[ -f "$APP/.env" ] && chmod 600 "$APP/.env" && chown aionbot:aionbot "$APP/.env"

# Migrations run before the new code starts, as the app user.
if [ -f "$APP/.env" ] && [ -f "$APP/packages/db/dist/migrate.js" ]; then
  echo "-- running migrations"
  ( set -a; . "$APP/.env"; set +a
    sudo -u aionbot --preserve-env=DATABASE_URL node "$APP/packages/db/dist/migrate.js" ) \
    || echo "!! migration failed (continuing so the service still starts)"
fi

systemctl daemon-reload
systemctl enable aion-bot >/dev/null 2>&1 || true
systemctl enable --now aion-watchdog.timer >/dev/null 2>&1 || true
systemctl restart aion-bot
if [ -d "$APP/web" ]; then
  systemctl enable aion-web >/dev/null 2>&1 || true
  systemctl restart aion-web
fi
sleep 5

if systemctl is-active --quiet aion-bot; then
  echo "-- aion-bot is active"
else
  echo "!! aion-bot failed to start"
fi
journalctl -u aion-bot -n 15 --no-pager
[ -d "$APP/web" ] && { echo '-- web --'; systemctl is-active aion-web || journalctl -u aion-web -n 15 --no-pager; }
systemctl is-active --quiet aion-bot
