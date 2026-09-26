#!/usr/bin/env bash
# Runs ON the VPS. Extracts the bundle, migrates, restarts. Idempotent.
set -euo pipefail

APP=/opt/aion
RELEASES=/opt/aion-releases
STAGING=${1:-/opt/aion-staging}

[ -d "$STAGING" ] || { echo "staging dir $STAGING not found"; exit 1; }

mkdir -p "$APP" "$RELEASES"
id -u aionbot >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin aionbot

# Keep the last 3 releases so a bad deploy can be rolled back by hand.
#
# Hard links, not copies. A full copy duplicated production node_modules every
# single deploy — several hundred megabytes each, three of them kept, on an
# 18 GB disk. `cp -al` gives the same rollback for the cost of the directory
# entries, because the files are identical until a deploy replaces one.
if [ -d "$APP/apps" ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  cp -al "$APP" "$RELEASES/$STAMP" 2>/dev/null || cp -a "$APP" "$RELEASES/$STAMP"
  ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
fi

# Staging already holds exactly what should be live — rsync put it there and
# only sent what changed. Copying it across locally is disk-to-disk and takes
# a moment. --delete so a file dropped from the build is dropped here too.
#
# .env, run/ and web/ live only on the server and must survive.
#
# Every pattern is anchored with a leading slash, which in rsync means "the
# root of this transfer" rather than the root of the filesystem. Without it a
# pattern matches the END of a path at ANY depth, so `web/` protected
# /opt/aion/web as intended and also silently refused to send
# webdist/apps/web/ — the entire Next.js standalone server. The bundle arrived
# with an empty apps/, got swapped in as the live web/, and the panel spent a
# day in a restart loop on `CHDIR: No such file or directory` while the deploy
# reported success. `run/` had the same reach into node_modules.
rsync -a --delete \
  --exclude '/.env' --exclude '/run/' --exclude '/web/' --exclude '/web.old/' \
  "$STAGING/" "$APP/"

install -m 644 "$APP/deploy/systemd/aion-bot.service" /etc/systemd/system/
[ -f "$APP/deploy/systemd/aion-web.service" ] && install -m 644 "$APP/deploy/systemd/aion-web.service" /etc/systemd/system/
install -m 644 "$APP/deploy/systemd/aion-watchdog.service" /etc/systemd/system/
install -m 644 "$APP/deploy/systemd/aion-watchdog.timer" /etc/systemd/system/
# The bot writes its heartbeat here and the watchdog reads it.
mkdir -p "$APP/run"

# The web bundle ships as webdist/ and is swapped in atomically.
#
# Checked before the swap, not after. The old code moved the live panel out of
# the way and the new bundle in without ever asking whether the new one could
# start, so a bundle that lost its server on the way here destroyed a working
# panel and replaced it with a directory that cannot even be entered. The one
# file systemd needs is the one worth proving.
if [ -d "$APP/webdist" ]; then
  if [ -f "$APP/webdist/apps/web/server.js" ]; then
    rm -rf "$APP/web.old"
    [ -d "$APP/web" ] && mv "$APP/web" "$APP/web.old"
    mv "$APP/webdist" "$APP/web"
    rm -rf "$APP/web.old"
  else
    echo "!! webdist has no apps/web/server.js — keeping the panel that is already live"
    find "$APP/webdist" -maxdepth 3 | head -20
    rm -rf "$APP/webdist"
    WEB_BUNDLE_BAD=1
  fi
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

# Slash command definitions are published to Discord, not shipped in the
# bundle, so a deploy that adds or changes a command does nothing visible until
# this runs. It used to be a manual step, which meant a new command could sit
# deployed and uninvokable with nothing in the logs to say so. Idempotent: it
# PUTs the whole set, so re-running it changes nothing when nothing changed.
if [ -f "$APP/.env" ] && [ -f "$APP/apps/bot/dist/register.js" ]; then
  echo "-- registering slash commands"
  ( set -a; . "$APP/.env"; set +a
    sudo -u aionbot --preserve-env=DISCORD_TOKEN,DISCORD_CLIENT_ID,LIVE_GUILD_ID \
      node "$APP/apps/bot/dist/register.js" ) \
    || echo "!! command registration failed (continuing; run it by hand)"
fi

systemctl daemon-reload
systemctl enable aion-bot >/dev/null 2>&1 || true
systemctl enable --now aion-watchdog.timer >/dev/null 2>&1 || true
systemctl restart aion-bot
if [ -d "$APP/web" ]; then
  systemctl enable aion-web >/dev/null 2>&1 || true
  systemctl restart aion-web
fi
# The bot writes its first heartbeat once the ready handler finishes, which is
# a few seconds after the process starts. Wait for the real signal, not the
# process table.
for _ in $(seq 1 12); do
  [ -f "$APP/run/bot.heartbeat.json" ] && break
  sleep 1
done

if systemctl is-active --quiet aion-bot; then
  echo "-- aion-bot is active"
else
  echo "!! aion-bot failed to start"
fi
journalctl -u aion-bot -n 45 --no-pager

echo '-- watchdog --'
systemctl is-active aion-watchdog.timer || echo '!! watchdog timer is not running'
if [ -f "$APP/run/bot.heartbeat.json" ]; then
  age=$(( $(date +%s) - $(( $(sed -n 's/.*"ts":\([0-9]*\).*/\1/p' "$APP/run/bot.heartbeat.json") / 1000 )) ))
  echo "-- heartbeat written ${age}s ago"
else
  echo '!! no heartbeat file — the bot could not write to '"$APP/run"
fi
# The panel's health is reported, not assumed.
#
# This used to print `systemctl is-active` and ignore the answer, so a web
# service that had failed 9421 times in a row still left a green deploy. The
# bot's exit code is what gates the workflow and that stays true — a broken
# panel must not look like a broken bot — but silence is what let this run for
# a day unnoticed.
if [ -d "$APP/web" ]; then
  echo '-- web --'
  if systemctl is-active --quiet aion-web; then
    echo 'aion-web is active'
  else
    echo '!! aion-web is NOT active'
    journalctl -u aion-web -n 15 --no-pager
  fi
fi
# Written as an if, not `test && echo`: under `set -e` an AND-list whose test
# fails takes the exit status of the whole list, and would end the script here
# on the ordinary path where the bundle was fine.
if [ -n "${WEB_BUNDLE_BAD:-}" ]; then
  echo '!! the web bundle was rejected this deploy — see above'
fi
systemctl is-active --quiet aion-bot
