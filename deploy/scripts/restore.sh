#!/usr/bin/env bash
# Restore an AION backup.
# Usage: restore.sh <archive.tar.gz | archive.tar.gz.enc>
set -euo pipefail

ARCHIVE=${1:-}
[ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || { echo "usage: $0 <archive>"; exit 1; }
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL must be set"; exit 1; }

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp "$ARCHIVE" "$WORK/"
cd "$WORK"
NAME=$(basename "$ARCHIVE")

if [[ "$NAME" == *.enc ]]; then
  read -r -s -p "Backup passphrase: " PASS; echo
  node "$HERE/decrypt-backup.mjs" "$NAME" "$PASS"
  unset PASS
  NAME=$(ls ./*.tar.gz | head -1)
fi

tar -xzf "$NAME"
[ -f database.sql.gz ] || { echo "archive has no database.sql.gz"; exit 1; }

echo
echo "About to restore into: ${DATABASE_URL##*@}"
echo "This DROPS and recreates every table in that database."
read -r -p "Type RESTORE to continue: " CONFIRM
[ "$CONFIRM" = "RESTORE" ] || { echo "Aborted."; exit 1; }

gunzip -c database.sql.gz | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
echo "Database restored."

if [ -f structure.json ]; then
  OUT="${STRUCTURE_OUT:-$(dirname "$(readlink -f "$ARCHIVE")")/aion-structure.json}"
  cp structure.json "$OUT"
  echo "Server structure written to $OUT"
  echo "  (every role, channel and permission overwrite, for rebuilding the guild itself)"
fi
