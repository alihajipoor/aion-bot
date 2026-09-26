import { spawn } from 'node:child_process';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import nodemailer from 'nodemailer';
import { ChannelType, type Guild } from 'discord.js';
import { getDb, backups } from '@aion/db';
import { desc, eq } from 'drizzle-orm';
import { settings } from '../lib/settings.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import type { AionClient } from '../client.js';

const log = logger('backup');
const DIR = process.env.BACKUP_DIR ?? '/opt/aion/backups';
const CHECK_MS = 15 * 60_000;

/* ── pieces of a backup ────────────────────────────────────────── */

/** pg_dump streamed straight to disk; the database never fits in memory twice. */
function dumpDatabase(target: string, excludeMessages: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = config.databaseUrl;
    if (!url) return reject(new Error('DATABASE_URL not set'));

    const args = ['--no-owner', '--no-acl', '--clean', '--if-exists'];
    // Message bodies dominate the dump and expire within a day anyway.
    if (excludeMessages) args.push('--exclude-table-data=message_cache');
    args.push(url);

    const proc = spawn('pg_dump', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += String(d); });

    pipeline(proc.stdout, createGzip({ level: 9 }), createWriteStream(target))
      .then(() => resolve())
      .catch(reject);

    proc.on('error', reject);
    proc.on('close', (code: number | null) => { if (code !== 0) reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 300)}`)); });
  });
}

/** Full guild structure, so a server can be rebuilt even without the database. */
async function dumpStructure(guild: Guild): Promise<string> {
  await guild.roles.fetch();
  await guild.channels.fetch();
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    guild: { id: guild.id, name: guild.name, ownerId: guild.ownerId, memberCount: guild.memberCount },
    roles: [...guild.roles.cache.values()].sort((a, b) => b.position - a.position).map(r => ({
      id: r.id, name: r.name, color: r.hexColor, hoist: r.hoist, position: r.position,
      managed: r.managed, permissions: r.permissions.toArray(),
    })),
    // Threads carry no overwrites of their own and are not part of the layout.
    channels: [...guild.channels.cache.values()]
      .filter(c => !!c && !c.isThread())
      .map(c => ({
        id: c!.id, name: c!.name, type: ChannelType[c!.type], parentId: c!.parentId,
        overwrites: [...((c as { permissionOverwrites?: { cache: Map<string, {
          id: string; type: number; allow: { toArray(): string[] }; deny: { toArray(): string[] };
        }> } }).permissionOverwrites?.cache.values() ?? [])].map(o => ({
          id: o.id, type: o.type, allow: o.allow.toArray(), deny: o.deny.toArray(),
        })),
      })),
  }, null, 2);
}

/**
 * AES-256-GCM under a scrypt-derived key. The passphrase never leaves the
 * server, so a backup sitting in an inbox is useless on its own.
 */
function encrypt(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  // salt | iv | tag | ciphertext — restore reads them back in this order.
  return Buffer.concat([salt, iv, cipher.getAuthTag(), body]);
}

/* ── the job ───────────────────────────────────────────────────── */

export interface BackupResult { ok: boolean; file?: string; bytes?: number; emailed: string[]; error?: string }

export async function runBackup(client: AionClient): Promise<BackupResult> {
  const cfg = settings().backup;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = `aion-${stamp}`;
  await mkdir(DIR, { recursive: true });

  const work = join(DIR, `.work-${stamp}`);
  const sqlPath = join(work, 'database.sql.gz');
  const jsonPath = join(work, 'structure.json');
  let finalPath = join(DIR, `${base}.tar.gz`);
  const emailed: string[] = [];

  try {
    await mkdir(work, { recursive: true });
    await dumpDatabase(sqlPath, !cfg.includeMessages);

    const guild = client.guilds.cache.get(config.guildId);
    if (guild) await writeFile(jsonPath, await dumpStructure(guild), 'utf8');

    // One standard archive holding both parts. Previously the structure export
    // was only bundled on the encrypted path and was silently dropped otherwise.
    await tarball(work, finalPath);

    const passphrase = process.env.BACKUP_PASSPHRASE ?? '';
    if (cfg.encrypt && passphrase) {
      const enc = join(DIR, `${base}.tar.gz.enc`);
      await writeFile(enc, encrypt(await readFile(finalPath), passphrase));
      await rm(finalPath, { force: true });
      finalPath = enc;
    } else if (cfg.encrypt && !passphrase) {
      log.warn('encryption is enabled but BACKUP_PASSPHRASE is unset — archive left in the clear');
    }

    await rm(work, { recursive: true, force: true });

    const { size } = await stat(finalPath);
    if (cfg.recipients.length) emailed.push(...await email(finalPath, base, size, cfg.recipients));

    await prune(cfg.keepLocal);
    await record(base, size, emailed, true);

    log.info(`backup ${base} — ${(size / 1048576).toFixed(1)} MB, emailed to ${emailed.length}`);
    return { ok: true, file: finalPath, bytes: size, emailed };
  } catch (e) {
    const error = (e as Error).message;
    log.error('backup failed', error);
    await rm(work, { recursive: true, force: true }).catch(() => {});
    await record(base, 0, [], false, error).catch(() => {});
    return { ok: false, emailed, error };
  }
}

/** Standard tar.gz so the archive opens with ordinary tools. */
function tarball(dir: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', ['-czf', target, '-C', dir, '.'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += String(d); });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${stderr.slice(0, 200)}`)));
  });
}

async function email(path: string, base: string, size: number, to: string[]): Promise<string[]> {
  const host = process.env.SMTP_HOST;
  if (!host) { log.warn('SMTP not configured — backup kept locally only'); return []; }

  // Most providers reject attachments over ~25 MB.
  if (size > 24 * 1024 * 1024) {
    log.warn(`backup is ${(size / 1048576).toFixed(1)} MB — too large to email, kept locally`);
    return [];
  }

  const secure = process.env.SMTP_SECURE === 'true';
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure,
    // On 587 the connection starts plaintext and upgrades. Demand the upgrade
    // rather than allowing a silent fallback that would send credentials in clear.
    requireTLS: !secure,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'aion@localhost',
    to: to.join(', '),
    subject: `AION backup — ${base}`,
    text: [
      `Automatic backup of the AION Discord server.`,
      ``,
      `File: ${base}`,
      `Size: ${(size / 1048576).toFixed(2)} MB`,
      `Taken: ${new Date().toISOString()}`,
      ``,
      path.endsWith('.enc')
        ? 'Encrypted with AES-256-GCM. Restore with deploy/scripts/restore.sh, which asks for the passphrase.'
        : 'Plain tar.gz — contains database.sql.gz and structure.json. Restore with deploy/scripts/restore.sh.',
    ].join('\n'),
    attachments: [{ filename: path.split('/').pop()!, path }],
  });
  return to;
}

/** Keep only the newest N archives on disk. */
async function prune(keep: number): Promise<void> {
  const files = (await readdir(DIR)).filter(f => f.startsWith('aion-')).sort().reverse();
  for (const f of files.slice(keep)) await rm(join(DIR, f), { force: true });
}

async function record(filename: string, bytes: number, emailedTo: string[], ok: boolean, error?: string) {
  await getDb().insert(backups).values({
    guildId: config.guildId, filename, sizeBytes: bytes, emailedTo, ok, error: error ?? null,
  });
}

/**
 * The day the last backup was taken, according to the database.
 *
 * This used to be a variable in the worker's closure, which made "already done
 * today" mean "already done since this process started". Every restart cleared
 * it, and every deploy is a restart — so a day with eleven deploys produced
 * eleven full backups, eleven `backups` rows, and eleven emails carrying the
 * entire database as an attachment. The daily schedule quietly became a
 * per-deploy one, and the mailbox was the only place it showed.
 *
 * The `backups` table already records every run, so it is the thing that
 * actually knows. A failed run counts: it means the hour came round and was
 * attempted, and retrying it fifteen minutes later would resend whatever went
 * wrong all over again.
 */
async function lastBackupDay(): Promise<string | null> {
  const [row] = await getDb().select({ createdAt: backups.createdAt })
    .from(backups)
    .where(eq(backups.guildId, config.guildId))
    .orderBy(desc(backups.createdAt))
    .limit(1);
  return row ? row.createdAt.toISOString().slice(0, 10) : null;
}

export function startBackupWorker(client: AionClient): NodeJS.Timeout {
  const tick = async () => {
    const cfg = settings().backup;
    if (!cfg.enabled) return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getUTCHours() < cfg.hourUtc) return;
    // Read on every tick rather than cached: a cache is exactly what broke this.
    const last = await lastBackupDay().catch(e => {
      // Unreachable database means we cannot tell whether today is done. Skip
      // rather than guess — a missed backup is recoverable, a restart loop that
      // mails the database every fifteen minutes is not.
      log.error('cannot read the last backup date — skipping this tick', e);
      return today;
    });
    if (last === today) return;
    await runBackup(client);
  };
  const timer = setInterval(() => void tick(), CHECK_MS);
  timer.unref?.();
  log.info('backup worker started');
  return timer;
}

/** Send a small test message so mail can be verified without a full backup. */
export async function testMail(to: string): Promise<{ ok: boolean; message: string }> {
  const host = process.env.SMTP_HOST;
  if (!host) return { ok: false, message: 'SMTP_HOST is not set.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, message: 'Give a valid address.' };

  const secure = process.env.SMTP_SECURE === 'true';
  try {
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure,
      requireTLS: !secure,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
    });
    await transport.verify();
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'aion@localhost',
      to,
      subject: 'AION — mail test',
      text: [
        'Mail delivery from the AION bot is working.',
        '',
        `Host: ${host}:${process.env.SMTP_PORT ?? 587} (${secure ? 'TLS' : 'STARTTLS'})`,
        `Encryption of archives: ${process.env.BACKUP_PASSPHRASE ? 'on' : 'OFF'}`,
        '',
        'Nightly backups will arrive at the addresses set in the panel.',
      ].join('\n'),
    });
    return { ok: true, message: `Test message sent to ${to}.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
