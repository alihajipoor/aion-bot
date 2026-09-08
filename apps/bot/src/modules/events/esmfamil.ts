import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction,
  type Guild, type TextChannel,
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

/** What a scored round awarded, kept so a challenge can undo exactly it. */
interface LastRound {
  round: number;
  letter: string;
  answers: Answers;
  /** column -> userId -> points */
  awarded: Record<string, Record<string, number>>;
  voided: string[];          // `${userId}:${column}`
}

interface Challenge {
  targetId: string;
  column: string;
  answer: string;
  byId: string;
  votes: Record<string, 'y' | 'n'>;
  messageId?: string;
}

interface State {
  config?: Partial<EsmFamilConfig>;
  round?: number;
  letter?: string;
  answers?: Answers;
  scores?: Record<string, number>;
  phase?: 'idle' | 'collecting' | 'scored';
  roundMessageId?: string;
  lastRound?: LastRound;
  challenge?: Challenge | null;
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
  const awarded: Record<string, Record<string, number>> = {};
  const lines: string[] = [];

  for (const col of cfg.columns) {
    const scores = scoreColumn(col, answers);
    if (!scores.length) continue;
    awarded[col] = {};
    lines.push(`**${col}**`);
    for (const s of scores.sort((a, b) => b.points - a.points)) {
      totals[s.userId] = (totals[s.userId] ?? 0) + s.points;
      awarded[col]![s.userId] = s.points;
      lines.push(`-# ${s.points === 0 ? '—' : `\`+${s.points}\``} <@${s.userId}> ${s.raw ? `· ${isolate(s.raw)}` : ''}`);
    }
    lines.push('');
  }

  await mergeState(ev.id, {
    phase: 'scored', scores: totals, challenge: null,
    lastRound: { round: st.round ?? 1, letter: st.letter ?? '', answers, awarded, voided: [] },
  });

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
    const st2 = ev.state as State;
    const last = st2.lastRound;
    if (!last) { await i.reply({ content: 'Hanooz dasti emtiaz nagerefte.', flags: MessageFlags.Ephemeral }); return; }
    if (st2.challenge) { await i.reply({ content: 'Ye etraz hanooz baze — aval oon ro tamoom konid.', flags: MessageFlags.Ephemeral }); return; }

    // Everything still standing from the last round, minus what is already void.
    const options = Object.entries(last.answers).flatMap(([userId, cols]) =>
      Object.entries(cols)
        .filter(([col, raw]) => raw.trim() && !last.voided.includes(`${userId}:${col}`))
        .map(([col, raw]) => ({ userId, col, raw })));

    if (!options.length) { await i.reply({ content: 'Chizi baraye etraz nist.', flags: MessageFlags.Ephemeral }); return; }

    const roster = await players(ev.id);
    const tagOf = (id: string) => roster.find(p => p.userId === id)?.userTag ?? id;

    await i.reply({
      components: [new ContainerBuilder().setAccentColor(C.wait)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '### ⚖️ Etraz\nBe kodoom javab etraz dari? Jam ray midan.'))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId(enc('pick', ev.id))
            .setPlaceholder('Javab ro entekhab kon')
            .addOptions(options.slice(0, 25).map(o =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${o.col}: ${o.raw}`.slice(0, 100))
                .setDescription(String(tagOf(o.userId)).slice(0, 100))
                .setValue(`${o.userId}|${o.col}`)))))],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  if (step === 'vote') {
    const st2 = ev.state as State;
    const ch = st2.challenge;
    if (!ch) { await i.reply({ content: 'In etraz baste shode.', flags: MessageFlags.Ephemeral }); return; }

    const roster = await players(ev.id);
    if (!roster.some(p => p.userId === i.user.id)) {
      await i.reply({ content: 'Faghat bazikon ha ray midan.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (i.user.id === ch.targetId) {
      await i.reply({ content: 'Sahebe javab ray nemide.', flags: MessageFlags.Ephemeral });
      return;
    }

    await i.deferUpdate();
    const votes = { ...ch.votes, [i.user.id]: (dec(i.customId)[2] as 'y' | 'n') };
    await mergeState(ev.id, { challenge: { ...ch, votes } });
    await settleChallenge(i.guild!, ev.id, false);
    return;
  }

  if (step === 'settle') {
    if (!host) { await i.reply({ content: 'Faghat gardanande.', flags: MessageFlags.Ephemeral }); return; }
    await i.deferUpdate();
    await settleChallenge(i.guild!, ev.id, true);
    return;
  }
}

export async function esmSelect(i: StringSelectMenuInteraction): Promise<void> {
  const [step, idRaw] = dec(i.customId);
  if (step !== 'pick') return;
  const ev = await getEvent(Number(idRaw));
  if (!ev) return;

  const [targetId, column] = i.values[0]!.split('|');
  const last = (ev.state as State).lastRound;
  const answer = last?.answers[targetId!]?.[column!] ?? '';

  await mergeState(ev.id, {
    challenge: { targetId, column, answer, byId: i.user.id, votes: {} },
  });

  const roster = await players(ev.id);
  const ch = channelOf(i.guild!, ev);
  const msg = await ch?.send(challengeCard({
    targetId: targetId!, column: column!, answer, byId: i.user.id, votes: {},
  }, ev.id, roster.length)).catch(() => null);

  if (msg) {
    const cur = (await getEvent(ev.id))!.state as State;
    await mergeState(ev.id, { challenge: { ...cur.challenge!, messageId: msg.id } });
  }
  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.wait)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('Etraz ferestade shod.'))],
    flags: MessageFlags.IsComponentsV2,
  });
}

function challengeCard(ch: Challenge, eventId: number, roster: number) {
  const yes = Object.values(ch.votes).filter(v => v === 'y').length;
  const no = Object.values(ch.votes).filter(v => v === 'n').length;
  const need = Math.floor((roster - 1) / 2) + 1;

  return {
    components: [new ContainerBuilder().setAccentColor(C.wait)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ⚖️ Etraz be yek javab\n<@${ch.byId}> be javabe <@${ch.targetId}> etraz dare.`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `**${ch.column}** → ${isolate(ch.answer)}`,
        '',
        `✅ **${yes}** ghabool   ·   ❌ **${no}** rad`,
        `-# Baraye tasmim ${need} ray lazem e. Sahebe javab ray nemide.`,
      ].join('\n')))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('vote', eventId, 'y')).setLabel('Ghabool').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(enc('vote', eventId, 'n')).setLabel('Rad').setEmoji('❌').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(enc('settle', eventId)).setLabel('Tamoom').setEmoji('🔒').setStyle(ButtonStyle.Secondary)))],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] as never[] },
  };
}

/**
 * Resolves a challenge when a side reaches a majority, or when the host calls
 * it. Rejecting an answer does not just zero one score: removing it can make a
 * neighbour's answer unique, so the whole column is scored again and the
 * difference applied to the running totals.
 */
async function settleChallenge(guild: Guild, eventId: number, force: boolean): Promise<void> {
  const ev = await getEvent(eventId);
  if (!ev) return;
  const st = ev.state as State;
  const ch = st.challenge;
  const last = st.lastRound;
  if (!ch || !last) return;

  const roster = await players(eventId);
  const voters = Math.max(1, roster.length - 1);
  const need = Math.floor(voters / 2) + 1;
  const yes = Object.values(ch.votes).filter(v => v === 'y').length;
  const no = Object.values(ch.votes).filter(v => v === 'n').length;

  const chan = channelOf(guild, ev);
  const msg = ch.messageId ? await chan?.messages.fetch(ch.messageId).catch(() => null) : null;

  if (!force && yes < need && no < need) {
    await msg?.edit(challengeCard(ch, eventId, roster.length)).catch(() => {});
    return;
  }

  const rejected = no >= yes && (no >= need || force);
  const totals = { ...(st.scores ?? {}) };
  let note = 'Javab ghabool shod — chizi avaz nashod.';

  if (rejected) {
    const key = `${ch.targetId}:${ch.column}`;
    const answers: Answers = JSON.parse(JSON.stringify(last.answers));
    if (answers[ch.targetId]) answers[ch.targetId]![ch.column] = '';

    const before = last.awarded[ch.column] ?? {};
    const after = scoreColumn(ch.column, answers);
    for (const s of after) {
      totals[s.userId] = (totals[s.userId] ?? 0) - (before[s.userId] ?? 0) + s.points;
    }
    const nextAwarded = { ...last.awarded, [ch.column]: Object.fromEntries(after.map(s => [s.userId, s.points])) };

    await mergeState(eventId, {
      scores: totals, challenge: null,
      lastRound: { ...last, answers, awarded: nextAwarded, voided: [...last.voided, key] },
    });
    note = `Javab rad shod — sotoone **${ch.column}** dobare emtiaz gereft.`;
  } else {
    await mergeState(eventId, { challenge: null });
  }

  const board = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  await msg?.edit({
    components: [new ContainerBuilder().setAccentColor(rejected ? C.wait : C.done)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ⚖️ Etraz ${rejected ? 'ghabool' : 'rad'} shod`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `**${ch.column}** → ${isolate(ch.answer)} (<@${ch.targetId}>)`,
        `✅ ${yes}  ·  ❌ ${no}`,
        '',
        note,
        '',
        ...board.slice(0, 10).map(([id, pts], i) =>
          `${['🥇', '🥈', '🥉'][i] ?? `\`${i + 1}\``} <@${id}> — **${pts}**`),
      ].join('\n')))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch(() => {});

  log.info(`esm famil #${eventId} challenge ${rejected ? 'upheld' : 'dismissed'} (${yes}/${no})`);
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
