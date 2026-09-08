import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ModalSubmitInteraction, type Guild, type TextChannel,
} from 'discord.js';
import { normalizePersian, isolate } from '../../lib/text.js';
import { logger } from '../../lib/log.js';
import { getEvent, mergeState, players, type EventRow } from './store.js';
import { ESM_DEFAULTS, type EsmFamilConfig } from './games.js';

const log = logger('esmfamil');
export const ESM_ID = 'ef';
const enc = (...p: (string | number)[]) => [ESM_ID, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const C = { play: 0x4aa6ff, done: 0x57f287, wait: 0xfee75c } as const;

interface Answers { [userId: string]: Record<string, string> }
interface State {
  config?: Partial<EsmFamilConfig>;
  round?: number;
  letter?: string;
  answers?: Answers;
  scores?: Record<string, number>;
  phase?: 'idle' | 'collecting' | 'scored';
  roundMessageId?: string;
}

const cfgOf = (ev: EventRow): EsmFamilConfig =>
  ({ ...ESM_DEFAULTS, ...((ev.state as State).config ?? {}) });

/** Round timers are in memory; a restart mid-round just means the host closes it. */
const timers = new Map<number, NodeJS.Timeout>();

const channelOf = (guild: Guild, ev: EventRow): TextChannel | undefined =>
  ev.textChannelId ? guild.channels.cache.get(ev.textChannelId) as TextChannel | undefined : undefined;

/* ── scoring ───────────────────────────────────────────────────── */

export interface ColumnScore { userId: string; raw: string; points: number; note: string }

/**
 * The rules as they are actually played: 20 when you are the only one who
 * filled that column, 10 when your answer is yours alone, 5 when someone
 * matched it, 0 for blank.
 *
 * Everything is compared through normalizePersian, because "تهران" typed with
 * an Arabic yeh and "تهران" typed with a Persian one are the same city, and
 * scoring them apart makes the whole board nonsense.
 */
export function scoreColumn(column: string, answers: Answers): ColumnScore[] {
  const filled = Object.entries(answers)
    .map(([userId, cols]) => ({ userId, raw: (cols[column] ?? '').trim() }))
    .filter(a => a.raw.length > 0);

  const blanks = Object.keys(answers)
    .filter(u => !(answers[u]?.[column] ?? '').trim())
    .map(userId => ({ userId, raw: '', points: 0, note: 'khali' }));

  if (filled.length === 1) {
    return [{ ...filled[0]!, points: 20, note: 'tanha javab' }, ...blanks];
  }

  const groups = new Map<string, number>();
  for (const a of filled) {
    const key = normalizePersian(a.raw).toLowerCase();
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  return [
    ...filled.map(a => {
      const key = normalizePersian(a.raw).toLowerCase();
      const shared = (groups.get(key) ?? 1) > 1;
      return { ...a, points: shared ? 5 : 10, note: shared ? 'tekrari' : 'monhaser be fard' };
    }),
    ...blanks,
  ];
}

const pickLetter = (pool: string): string => pool[Math.floor(Math.random() * pool.length)]!;

/* ── lifecycle ─────────────────────────────────────────────────── */

export async function startEsmFamil(guild: Guild, ev: EventRow): Promise<void> {
  await mergeState(ev.id, { phase: 'idle', round: 0, scores: {}, answers: {} });
  const ch = channelOf(guild, ev);
  const cfg = cfgOf(ev);
  await ch?.send({
    components: [new ContainerBuilder().setAccentColor(C.play)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ✍️ ${isolate(ev.title)}\nEsm Famil — ${cfg.rounds} dast, har dast ${cfg.roundSeconds} sanie.`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `**Sotoon ha**  ${cfg.columns.join(' · ')}`,
        '',
        '**Emtiaz**',
        '`20` age faghat to oon sotoon ro por karde bashi',
        '`10` javabet monhaser be fard bashe',
        '`5` yeki dige ham hamoon ro neveshte bashe',
        '`0` khali',
        '',
        '-# Javab ha normalize mishan — ي/ی, ك/ک va nim-fasele farghi nemikonan.',
      ].join('\n')))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('next', ev.id)).setLabel('Daste baad').setEmoji('▶️').setStyle(ButtonStyle.Success)))],
    flags: MessageFlags.IsComponentsV2,
  }).catch(() => {});
  log.info(`esm famil #${ev.id} ready`);
}

export async function endEsmFamil(_guild: Guild, ev: EventRow): Promise<void> {
  const t = timers.get(ev.id);
  if (t) { clearTimeout(t); timers.delete(ev.id); }
}

async function openRound(guild: Guild, ev: EventRow): Promise<void> {
  const cfg = cfgOf(ev);
  const st = ev.state as State;
  const round = (st.round ?? 0) + 1;
  const letter = pickLetter(cfg.letterPool);

  await mergeState(ev.id, { phase: 'collecting', round, letter, answers: {} });

  const ch = channelOf(guild, ev);
  const ends = Math.floor((Date.now() + cfg.roundSeconds * 1000) / 1000);
  const msg = await ch?.send({
    components: [new ContainerBuilder().setAccentColor(C.play)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${letter}\n## Daste ${round} az ${cfg.rounds}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `Hameye sotoon ha ba **${letter}** shoroo beshan.`,
        `**${cfg.columns.join(' · ')}**`,
        '',
        `⏳ Tamoom mishe <t:${ends}:R>`,
        '-# Javabet ro kesi nemibine ta dast baste beshe.',
      ].join('\n')))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('answer', ev.id)).setLabel('Javab bede').setEmoji('✍️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(enc('close', ev.id)).setLabel('Bastan').setEmoji('🔒').setStyle(ButtonStyle.Secondary)))],
    flags: MessageFlags.IsComponentsV2,
  }).catch(() => null);

  if (msg) await mergeState(ev.id, { roundMessageId: msg.id });

  const t = setTimeout(() => { void closeRound(guild, ev.id).catch(e => log.warn('auto close', e)); },
    cfg.roundSeconds * 1000);
  t.unref?.();
  timers.set(ev.id, t);
}

async function closeRound(guild: Guild, eventId: number): Promise<void> {
  const timer = timers.get(eventId);
  if (timer) { clearTimeout(timer); timers.delete(eventId); }

  const ev = await getEvent(eventId);
  if (!ev) return;
  const st = ev.state as State;
  if (st.phase !== 'collecting') return;

  const cfg = cfgOf(ev);
  const answers = st.answers ?? {};
  const roster = await players(ev.id);
  const name = (id: string) => roster.find(p => p.userId === id)?.userTag ?? id;

  const totals: Record<string, number> = { ...(st.scores ?? {}) };
  const lines: string[] = [];

  for (const col of cfg.columns) {
    const scores = scoreColumn(col, answers);
    if (!scores.length) continue;
    lines.push(`**${col}**`);
    for (const s of scores.sort((a, b) => b.points - a.points)) {
      totals[s.userId] = (totals[s.userId] ?? 0) + s.points;
      lines.push(`-# ${s.points === 0 ? '—' : `\`+${s.points}\``} <@${s.userId}> ${s.raw ? `· ${isolate(s.raw)}` : ''}`);
    }
    lines.push('');
  }

  await mergeState(ev.id, { phase: 'scored', scores: totals });

  const board = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const done = (st.round ?? 1) >= cfg.rounds;

  const ch = channelOf(guild, ev);
  await ch?.send({
    components: [new ContainerBuilder().setAccentColor(done ? C.done : C.wait)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🧮 Natijeye daste ${st.round} — harf **${st.letter}**`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        lines.length ? lines.join('\n').slice(0, 3500) : '-# Hich kas javab nadad.'))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        done ? '### 🏆 Jadval e nahayi' : '### 📊 Jadval',
        ...board.map(([id, pts], i) =>
          `${['🥇', '🥈', '🥉'][i] ?? `\`${i + 1}\``} <@${id}> — **${pts}**`),
      ].join('\n')))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('void', ev.id)).setLabel('Etraz').setEmoji('⚖️').setStyle(ButtonStyle.Secondary),
        ...(done ? [] : [new ButtonBuilder().setCustomId(enc('next', ev.id))
          .setLabel('Daste baad').setEmoji('▶️').setStyle(ButtonStyle.Success)])))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch(() => {});

  log.info(`esm famil #${ev.id} round ${st.round} scored, ${Object.keys(answers).length} answers`);
  void name;
}

/* ── interactions ──────────────────────────────────────────────── */

export async function esmComponent(i: ButtonInteraction): Promise<void> {
  const [step, idRaw] = dec(i.customId);
  const ev = await getEvent(Number(idRaw));
  if (!ev) { await i.reply({ content: 'Event peyda nashod.', flags: MessageFlags.Ephemeral }); return; }
  const host = i.user.id === ev.hostId;

  if (step === 'next') {
    if (!host) { await i.reply({ content: 'Faghat gardanande dast ro baz mikone.', flags: MessageFlags.Ephemeral }); return; }
    await i.deferUpdate();
    await openRound(i.guild!, (await getEvent(ev.id))!);
    return;
  }

  if (step === 'close') {
    if (!host) { await i.reply({ content: 'Faghat gardanande.', flags: MessageFlags.Ephemeral }); return; }
    await i.deferUpdate();
    await closeRound(i.guild!, ev.id);
    return;
  }

  if (step === 'answer') {
    const st = ev.state as State;
    if (st.phase !== 'collecting') {
      await i.reply({ content: 'Alan dasti baz nist.', flags: MessageFlags.Ephemeral });
      return;
    }
    const cfg = cfgOf(ev);
    const mine = st.answers?.[i.user.id] ?? {};
    // Discord allows five inputs in a modal, which is why the wizard caps columns there.
    await i.showModal(new ModalBuilder().setCustomId(enc('submit', ev.id))
      .setTitle(`Harf ${st.letter} — daste ${st.round}`)
      .addComponents(...cfg.columns.slice(0, 5).map(col =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId(col).setLabel(col)
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(40)
            .setValue(mine[col] ?? '')))));
    return;
  }

  if (step === 'void') {
    if (!host) { await i.reply({ content: 'Faghat gardanande.', flags: MessageFlags.Ephemeral }); return; }
    await i.reply({
      content: 'Baraye hazf e yek javab, esm e bazikon va sotoon ro too chat begoo — '
        + 'in ghesmat too nabard e badi ba ray giri jaygozin mishe.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function esmModal(i: ModalSubmitInteraction): Promise<void> {
  const [step, idRaw] = dec(i.customId);
  if (step !== 'submit') return;
  const ev = await getEvent(Number(idRaw));
  if (!ev) return;

  const st = ev.state as State;
  if (st.phase !== 'collecting') {
    await i.reply({ content: 'Dast baste shod — javabet sabt nashod.', flags: MessageFlags.Ephemeral });
    return;
  }

  const cfg = cfgOf(ev);
  const mine: Record<string, string> = {};
  for (const col of cfg.columns.slice(0, 5)) {
    mine[col] = i.fields.getTextInputValue(col).trim().slice(0, 40);
  }

  const answers: Answers = { ...(st.answers ?? {}), [i.user.id]: mine };
  await mergeState(ev.id, { answers });

  const filled = Object.values(mine).filter(Boolean).length;
  await i.reply({
    content: `Sabt shod ✅ ${filled} az ${cfg.columns.slice(0, 5).length} sotoon. Ta baste shodane dast mitooni avazesh koni.`,
    flags: MessageFlags.Ephemeral,
  });
}
