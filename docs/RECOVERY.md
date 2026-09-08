# Disaster recovery

Rebuilding AION from nothing needs two things: the GitHub repo and one backup
archive. Everything else — server, database, TLS — is reproducible.

## What a backup contains

| Part | Purpose |
|---|---|
| `*.sql.gz` | Full `pg_dump`: cases, sanctions, verifications, activity, logs, settings |
| `*.structure.json` | Every role, channel and permission overwrite in the Discord server |

Archives are **AES-256-GCM encrypted** with a scrypt-derived key from
`BACKUP_PASSPHRASE`. That passphrase lives only in `/opt/aion/.env` — an archive
sitting in an inbox is useless without it.

**Store the passphrase somewhere other than the server.** Losing it makes every
backup unrecoverable.

## Restoring

```bash
git clone git@github.com:alihajipoor/aion-bot.git /opt/aion
cd /opt/aion && bash deploy/scripts/install.sh     # swap, Postgres, systemd units
# put the secrets back into /opt/aion/.env (see .env.example)
DATABASE_URL=postgres://aion:PASSWORD@127.0.0.1:5432/aion \
  bash deploy/scripts/restore.sh aion-2026-09-08.tar.gz.enc
systemctl restart aion-bot aion-web
```

`restore.sh` asks for the passphrase, refuses to run without a typed
confirmation, and stops on the first SQL error rather than half-applying.

## Rebuilding the Discord server itself

If the guild is lost rather than the VPS, the structure JSON has every role,
channel and overwrite. `tools/setup/sync.mjs` recreates it from the reference
guild; the JSON is the record of what the live server looked like.

## What is not backed up

- **Message history** — Discord's, not ours. Only 24 hours of cached bodies exist,
  and they are excluded from archives by default.
- **Member role assignments** — these live in Discord. The structure export
  records which roles exist, not who held them.
- **Secrets** — never written into a backup. Restore them from your password
  manager.

## Checking a backup is real

A backup nobody has restored is a hypothesis. Test into a throwaway database:

```bash
sudo -u postgres createdb aion_test
DATABASE_URL=postgres://aion:PASSWORD@127.0.0.1:5432/aion_test \
  bash deploy/scripts/restore.sh <archive>
sudo -u postgres psql -d aion_test -c '\dt'
sudo -u postgres dropdb aion_test
```
