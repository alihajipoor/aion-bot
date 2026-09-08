#!/usr/bin/env node
// Runs from a systemd timer, outside the bot, so it still speaks when the bot
// cannot. Alerts on the transition only — one email when something breaks, one
// when it comes back, and silence in between.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import nodemailer from 'nodemailer';

const run = promisify(execFile);
const RUN_DIR = process.env.AION_RUN_DIR ?? '/opt/aion/run';
const HEARTBEAT = join(RUN_DIR, 'bot.heartbeat.json');
const STATE = join(RUN_DIR, 'watchdog.state.json');
const UNITS = (process.env.WATCHDOG_UNITS ?? 'aion-bot,aion-web,postgresql,caddy').split(',');

const read = async (f, dflt) => JSON.parse(await readFile(f, 'utf8').catch(() => JSON.stringify(dflt)));

async function unitActive(u) {
  const { stdout } = await run('systemctl', ['is-active', u]).catch(e => ({ stdout: e.stdout ?? 'unknown' }));
  return stdout.trim() === 'active';
}

async function diskPercent() {
  const { stdout } = await run('df', ['-P', '/']).catch(() => ({ stdout: '' }));
  const line = stdout.trim().split('\n')[1] ?? '';
  return Number((line.match(/(\d+)%/) ?? [])[1] ?? 0);
}

const checks = [];
const beat = await read(HEARTBEAT, null);
const cfg = beat?.alerts ?? {
  enabled: true,
  recipients: (process.env.ALERT_TO ?? '').split(',').map(s => s.trim()).filter(Boolean),
  heartbeatStaleSec: 300,
  diskWarnPercent: 85,
};

// ── heartbeat ──
if (!beat) {
  checks.push(['heartbeat', false, 'no heartbeat file — the bot has not run since the last deploy']);
} else {
  const age = Math.round((Date.now() - beat.ts) / 1000);
  checks.push(['heartbeat', age <= cfg.heartbeatStaleSec,
    `last beat ${age}s ago (limit ${cfg.heartbeatStaleSec}s)`]);
  if (beat.db === false) checks.push(['database', false, 'bot reports the database unreachable']);
  else checks.push(['database', true, 'reachable']);
}

// ── services ──
for (const u of UNITS) {
  const ok = await unitActive(u);
  checks.push([`unit:${u}`, ok, ok ? 'active' : 'NOT active']);
}

// ── disk ──
const disk = await diskPercent();
checks.push(['disk', disk < cfg.diskWarnPercent, `${disk}% used (limit ${cfg.diskWarnPercent}%)`]);

// ── report only what changed ──
await mkdir(RUN_DIR, { recursive: true });
const prev = await read(STATE, {});
const now = Object.fromEntries(checks.map(([k, ok]) => [k, ok]));
const changed = checks.filter(([k, ok]) => prev[k] !== undefined && prev[k] !== ok);
const firstBad = checks.filter(([k, ok]) => prev[k] === undefined && !ok);
const events = [...changed, ...firstBad];
await writeFile(STATE, JSON.stringify(now), 'utf8');

for (const [k, ok, detail] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${k.padEnd(18)} ${detail}`);

if (!events.length) process.exit(0);
if (!cfg.enabled || !cfg.recipients.length || !process.env.SMTP_HOST) {
  console.log('\nchanges detected but alerting is off or unconfigured');
  process.exit(0);
}

const broke = events.filter(([, ok]) => !ok);
const secure = process.env.SMTP_SECURE === 'true';
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure,
  requireTLS: !secure,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
});

await transport.sendMail({
  from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'aion@localhost',
  to: cfg.recipients.join(', '),
  subject: broke.length ? `AION ALERT — ${broke.map(([k]) => k).join(', ')}` : 'AION recovered',
  text: [
    broke.length ? 'Something on the AION host changed for the worse:' : 'AION is back to normal:',
    '',
    ...events.map(([k, ok, d]) => `  ${ok ? 'RECOVERED' : 'FAILED'}  ${k} — ${d}`),
    '',
    'Full state:',
    ...checks.map(([k, ok, d]) => `  ${ok ? 'ok  ' : 'FAIL'}  ${k} — ${d}`),
    '',
    beat ? `Bot: pid ${beat.pid}, ${beat.rssMb} MB, ${beat.members} members, up since ${new Date(beat.startedAt).toISOString()}` : 'Bot: no heartbeat',
    `Host time: ${new Date().toISOString()}`,
  ].join('\n'),
});
console.log(`\nalert sent to ${cfg.recipients.join(', ')}`);
