#!/usr/bin/env bash
# Restore an AION backup onto a fresh (or existing) database.
# Usage: restore.sh <archive.tar.gz.enc | dump.sql.gz>
set -euo pipefail

ARCHIVE=${1:-}
[ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || { echo "usage: $0 <archive>"; exit 1; }
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL must be set"; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp "$ARCHIVE" "$WORK/"
cd "$WORK"
NAME=$(basename "$ARCHIVE")

if [[ "$NAME" == *.enc ]]; then
  read -r -s -p "Backup passphrase: " PASS; echo
  node "$(dirname "$0")/decrypt-backup.mjs" "$NAME" "$PASS"
  unset PASS
  DUMP=$(ls ./*.sql.gz | head -1)
else
  DUMP="$NAME"
fi

echo
echo "About to restore $DUMP into:"
echo "  ${DATABASE_URL%%:*}://…@${DATABASE_URL##*@}"
echo "This DROPS and recreates every table in that database."
read -r -p "Type RESTORE to continue: " CONFIRM
[ "$CONFIRM" = "RESTORE" ] || { echo "Aborted."; exit 1; }

gunzip -c "$DUMP" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
echo "Database restored."

if ls ./*.structure.json >/dev/null 2>&1; then
  DEST="${STRUCTURE_OUT:-$PWD/../aion-structure.json}"
  cp ./*.structure.json "$DEST" 2>/dev/null || cp ./*.structure.json /tmp/
  echo "Server structure written alongside the archive — roles, channels and overwrites,"
  echo "for rebuilding the Discord server itself with tools/setup/sync.mjs."
fi
