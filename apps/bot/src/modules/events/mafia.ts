import {
  ChannelType, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, PermissionFlagsBits,
  type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction,
  type MessageComponentInteraction, type Guild, type GuildMember, type TextChannel,
} from 'discord.js';
import { isolate } from '../../lib/text.js';
import { logger } from '../../lib/log.js';
import {
  getEvent, patchEvent, mergeState, players, alivePlayers, assignRole,
  killPlayer, revivePlayer, type EventRow,
} from './store.js';
import {
  SCENARIOS, CITIZEN, scenarioOf, distribution, MAFIA_DEFAULTS,
  type RoleDef, type MafiaConfig,
} from './games.js';

const log = logger('mafia');
export const MAFIA_ID = 'mf';
const enc = (...p: (string | number)[]) => [MAFIA_ID, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const C = { night: 0x2b2d5c, day: 0xfee75c, mafia: 0xed4245, town: 0x57f287 } as const;

/**
 * Members the game is holding muted. The scoped-mute invariant in enforce.ts
 * re-derives server-mute on every move, and would happily unmute someone the
 * night has silenced. That reconciliation is where this bot has been bitten
 * before, so the game declares its people and voiceStateUpdate leaves them be.
 */
export const gameHeld = new Set<string>();

/* ── scenarios ─────────────────────────────────────────────────── */

/** The host's wizard choices, with defaults for events drafted before it. */
function configOf(ev: EventRow): MafiaConfig {
  const raw = (ev.state as { config?: Partial<MafiaConfig> }).config ?? {};
  return { ...MAFIA_DEFAULTS, ...raw };
}

const roleOf = (key: string | null): RoleDef =>
  SCENARIOS.flatMap(s => s.roles).find(r => r.key === key) ?? CITIZEN;

const shuffle = <T>(a: T[]): T[] => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j]!, x[i]!];
  }
  return x;
};

/* ── voice control ─────────────────────────────────────────────── */

/**
 * Night silences everyone; day returns the living. The dead stay muted for the
 * rest of the game, which is the rule a human narrator cannot enforce.
 */
async function applyVoice(guild: Guild, ev: EventRow, phase: 'night' | 'day'): Promise<number> {
  if (!ev.voiceChannelId) return 0;
  const roster = await players(ev.id);
  const byId = new Map(roster.map(p => [p.userId, p]));
  const channel = guild.channels.cache.get(ev.voiceChannelId);
  if (!channel?.isVoiceBased()) return 0;

  let touched = 0;
  for (const state of channel.members.values()) {
    const p = byId.get(state.id);
    if (!p) continue;                       // spectators are not the game's business
    const cfg = configOf(ev);
    const shouldMute = (phase === 'night' && cfg.autoMuteNight) || (!p.alive && cfg.deadStayMuted);
    gameHeld.add(state.id);
    if (state.voice.serverMute !== shouldMute) {
      await state.voice.setMute(shouldMute, `AION mafia ${phase}`).catch(() => {});
      touched++;
    }
  }
  return touched;
}

async function releaseVoice(guild: Guild, ev: EventRow): Promise<void> {
  const roster = await players(ev.id);
  for (const p of roster) {
    gameHeld.delete(p.userId);
    const m = guild.members.cache.get(p.userId);
    if (m?.voice.channelId && m.voice.serverMute) {
      await m.voice.setMute(false, 'AION mafia ended').catch(() => {});
    }
  }
}

/* ── start / end ───────────────────────────────────────────────── */

export async function startMafia(guild: Guild, ev: EventRow): Promise<void> {
  const roster = await players(ev.id);
  if (roster.length < 4) {
    log.warn(`event #${ev.id}: only ${roster.length} players, dealing anyway`);
  }

  const cfg = configOf(ev);
  const sc = scenarioOf(cfg.scenario);
  const roles = shuffle(distribution(sc, roster.length, cfg.optionalRoles));
  const seats = shuffle(roster);

  const owned = [...ev.ownedChannelIds];

  // The mafia team needs somewhere to talk at night that the town cannot read.
  const mafiaIds = seats.filter((_, idx) => roles[idx]!.side === 'mafia').map(p => p.userId);
  const cat = guild.channels.cache.get(ev.voiceChannelId ?? '')?.parentId;
  const room = !cfg.mafiaRoom ? null : await guild.channels.create({
    name: `🕵-mafia-${ev.id}`,
    type: ChannelType.GuildText,
    parent: cat ?? undefined,
    topic: `Otagh e mafia — event #${ev.id}`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: guild.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: ev.hostId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ...mafiaIds.map(id => ({
        id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      })),
    ],
    reason: `AION mafia #${ev.id}`,
  }).catch((e: Error) => { log.warn(`mafia room failed: ${e.message}`); return null; });
  if (room) owned.push(room.id);

  for (let i = 0; i < seats.length; i++) {
    const p = seats[i]!;
    const role = roles[i]!;
    await assignRole(ev.id, p.userId, role.key, role.side, i + 1);

    const member = guild.members.cache.get(p.userId);
    await member?.send({
      components: [new ContainerBuilder().setAccentColor(role.side === 'mafia' ? C.mafia : C.town)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## ${role.side === 'mafia' ? '🔴' : '🟢'} ${role.fa}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
          `**Sanario**  ${sc.fa}`,
          `**Side**  ${role.side === 'mafia' ? 'Mafia' : role.side === 'solo' ? 'Solo' : 'Shahr'}`,
          `**Sandali**  ${i + 1}`,
          '',
          role.blurb,
          '',
          role.side === 'mafia' && room ? `-# Otagh e mafia: <#${room.id}>` : '-# Be hich kas naghshet ro nagoo.',
        ].join('\n')))],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => log.warn(`could not DM ${p.userTag} their role`));
  }

  if (room && mafiaIds.length) {
    await room.send({
      components: [new ContainerBuilder().setAccentColor(C.mafia)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## 🔴 Team e Mafia\n${mafiaIds.map(id => `<@${id}>`).join(' · ')}\n-# Inja faghat shoma va gardanande mibinin.`))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  await patchEvent(ev.id, { ownedChannelIds: owned });
  await mergeState(ev.id, { phase: 'setup', night: 0, scenario: sc.key, votes: {} });
  log.info(`mafia #${ev.id}: ${sc.key}, ${roles.length} roles, ${mafiaIds.length} mafia`);
}

export async function endMafia(guild: Guild, ev: EventRow): Promise<void> {
  await releaseVoice(guild, ev);
}

/* ── the GM console ────────────────────────────────────────────── */

async function console_(ev: EventRow, note?: string) {
  const roster = await players(ev.id);
  const alive = roster.filter(p => p.alive);
  const state = ev.state as { phase?: string; night?: number };
  const phase = state.phase ?? 'setup';

  const mafiaAlive = alive.filter(p => p.side === 'mafia').length;
  const townAlive = alive.length - mafiaAlive;

  const box = new ContainerBuilder().setAccentColor(phase === 'night' ? C.night : C.day)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## 🎛 Console — ${phase === 'night' ? `🌙 Shab ${state.night ?? 1}` : phase === 'day' ? `☀️ Rooz ${state.night ?? 1}` : '🎬 Amade'}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `🔴 **Mafia** ${mafiaAlive}   ·   🟢 **Shahr** ${townAlive}`,
      '',
      ...roster.map(p =>
        `${p.alive ? '🟢' : '⚫'} \`${String(p.seat ?? 0).padStart(2, ' ')}\` <@${p.userId}> — ${roleOf(p.role).fa}`),
      ...(note ? ['', `> ${note}`] : []),
    ].join('\n')));

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('phase', ev.id, 'night')).setLabel('Shab').setEmoji('🌙')
      .setStyle(phase === 'night' ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(phase === 'night'),
    new ButtonBuilder().setCustomId(enc('phase', ev.id, 'day')).setLabel('Rooz').setEmoji('☀️')
      .setStyle(phase === 'day' ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(phase === 'day'),
    new ButtonBuilder().setCustomId(enc('vote', ev.id)).setLabel('Ray giri').setEmoji('🗳️').setStyle(ButtonStyle.Primary),
  ));

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'inquiry')).setLabel('Estelam').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'kill')).setLabel('Bokosh').setEmoji('💀').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'revive')).setLabel('Zende kon').setEmoji('❤️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('refresh', ev.id)).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  ));

  box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '-# Shab hameye bazikon-ha mute mishan. Rooz zende-ha baz mishan va morde-ha mute mimoonan.'));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

const canRun = (i: MessageComponentInteraction, ev: EventRow): boolean => {
  const m = i.member as GuildMember;
  return i.user.id === ev.hostId
    || m.permissions.has(PermissionFlagsBits.Administrator)
    || m.roles.cache.some(r => ['Consultant', 'PowerAdmin', 'Dev'].includes(r.name));
};

export async function mafiaComponent(i: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const [step, idRaw, arg] = dec(i.customId);
  const id = Number(idRaw);
  const ev = await getEvent(id);
  if (!ev) { await i.reply({ content: 'Event peyda nashod.', flags: MessageFlags.Ephemeral }); return; }

  // Players vote; everything else is the narrator's.
  if (step === 'ballot' && i.isStringSelectMenu()) { await castVote(i, ev); return; }

  if (!canRun(i, ev)) {
    await i.reply({ content: 'Faghat gardanande.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (step === 'console' || step === 'refresh') {
    const payload = await console_(ev);
    if (step === 'console') await i.reply(payload);
    else await i.update(payload);
    return;
  }

  if (step === 'phase') {
    const phase = arg as 'night' | 'day';
    const night = phase === 'night' ? ((ev.state as { night?: number }).night ?? 0) + 1 : ((ev.state as { night?: number }).night ?? 1);
    await mergeState(ev.id, { phase, night });
    const fresh = (await getEvent(ev.id))!;
    const touched = await applyVoice(i.guild!, fresh, phase);
    await announcePhase(i.guild!, fresh, phase);
    await i.update(await console_(fresh, `${phase === 'night' ? 'Shab' : 'Rooz'} shod — ${touched} nafar mute/unmute shodan.`));
    return;
  }

  if (step === 'act' && i.isButton()) {
    const kind = arg as 'inquiry' | 'kill' | 'revive';
    const list = kind === 'revive' ? (await players(ev.id)).filter(p => !p.alive) : await alivePlayers(ev.id);
    if (!list.length) {
      await i.reply({ content: 'Kesi baraye in kar nist.', flags: MessageFlags.Ephemeral });
      return;
    }
    await i.reply({
      components: [new ContainerBuilder().setAccentColor(C.day)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `### ${kind === 'inquiry' ? '🔍 Estelam' : kind === 'kill' ? '💀 Kosht' : '❤️ Zende kardan'}\nKi?`))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId(enc('pick', ev.id, kind))
            .setPlaceholder('Bazikon ro entekhab kon')
            .addOptions(list.slice(0, 25).map(p =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${p.seat ?? '?'} · ${(p.userTag ?? p.userId).slice(0, 60)}`)
                .setValue(p.userId)))))],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  if (step === 'pick' && i.isStringSelectMenu()) {
    const kind = arg as 'inquiry' | 'kill' | 'revive';
    const target = i.values[0]!;
    const roster = await players(ev.id);
    const p = roster.find(x => x.userId === target);
    if (!p) { await i.update({ content: 'Peyda nashod.', components: [] }); return; }

    if (kind === 'inquiry') {
      // The Godfather reads as a citizen — the whole point of the scenario.
      const shown = p.role === 'godfather' ? 'town' : p.side;
      await i.update({
        components: [new ContainerBuilder().setAccentColor(shown === 'mafia' ? C.mafia : C.town)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### 🔍 Natijeye estelam\n<@${target}> → **${shown === 'mafia' ? 'مافیا' : 'شهروند'}**\n-# Faghat to in ro didi.`))],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    if (kind === 'kill') await killPlayer(ev.id, target);
    else await revivePlayer(ev.id, target);

    const fresh = (await getEvent(ev.id))!;
    await applyVoice(i.guild!, fresh, ((fresh.state as { phase?: string }).phase as 'night' | 'day') ?? 'day');
    await i.update(await console_(fresh,
      `<@${target}> ${kind === 'kill' ? 'az baazi kharej shod' : 'bargasht be baazi'}.`));
    return;
  }

  if (step === 'vote' && i.isButton()) { await openVote(i, ev); return; }
  if (step === 'closevote' && i.isButton()) { await closeVote(i, ev); return; }
}

export async function mafiaModal(_i: ModalSubmitInteraction): Promise<void> {
  // Reserved: scenario editing arrives with the second scenario.
}

/* ── phase announcements ───────────────────────────────────────── */

async function announcePhase(guild: Guild, ev: EventRow, phase: 'night' | 'day'): Promise<void> {
  const ch = ev.textChannelId ? guild.channels.cache.get(ev.textChannelId) as TextChannel | undefined : undefined;
  if (!ch) return;
  const n = (ev.state as { night?: number }).night ?? 1;
  const alive = await alivePlayers(ev.id);

  await ch.send({
    components: [new ContainerBuilder().setAccentColor(phase === 'night' ? C.night : C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        phase === 'night'
          ? `## 🌙 Shab ${n}\nHame sakit — mic ha baste shod. Cheshm ha baste.`
          : `## ☀️ Rooz ${n}\nShahr bidar shod. ${alive.length} nafar zende an.`))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        alive.map(p => `🟢 \`${p.seat ?? '?'}\` <@${p.userId}>`).join('\n') || '-# —'))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

/* ── voting ────────────────────────────────────────────────────── */

async function openVote(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const ch = ev.textChannelId ? i.guild!.channels.cache.get(ev.textChannelId) as TextChannel | undefined : undefined;
  if (!ch) { await i.reply({ content: 'Channel e chat peyda nashod.', flags: MessageFlags.Ephemeral }); return; }

  const alive = await alivePlayers(ev.id);
  await mergeState(ev.id, { votes: {} });

  const msg = await ch.send({
    components: [new ContainerBuilder().setAccentColor(C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🗳️ Ray giri\nFaghat zende-ha ray midan. Har kas yek ray — avaz kardan azad e.`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Hanooz kesi ray nadade.'))
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(enc('ballot', ev.id))
          .setPlaceholder('Ray et ro bede')
          .addOptions(alive.slice(0, 25).map(p =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${p.seat ?? '?'} · ${(p.userTag ?? p.userId).slice(0, 60)}`)
              .setValue(p.userId)))))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('closevote', ev.id)).setLabel('Bastane ray giri')
          .setEmoji('🔒').setStyle(ButtonStyle.Danger)))],
    flags: MessageFlags.IsComponentsV2,
  });

  await mergeState(ev.id, { voteMessageId: msg.id });
  await i.reply({ content: `Ray giri baz shod too <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
}

async function castVote(i: StringSelectMenuInteraction, ev: EventRow): Promise<void> {
  const roster = await players(ev.id);
  const me = roster.find(p => p.userId === i.user.id);
  if (!me || !me.alive) {
    await i.reply({ content: 'Faghat bazikon-haye zende ray midan.', flags: MessageFlags.Ephemeral });
    return;
  }
  await i.deferUpdate();

  const votes = { ...(ev.state as { votes?: Record<string, string> }).votes ?? {} };
  votes[i.user.id] = i.values[0]!;
  await mergeState(ev.id, { votes });

  const tally = new Map<string, string[]>();
  for (const [voter, target] of Object.entries(votes)) {
    tally.set(target, [...(tally.get(target) ?? []), voter]);
  }
  const alive = roster.filter(p => p.alive).length;
  const majority = Math.floor(alive / 2) + 1;
  const ranked = [...tally.entries()].sort((a, b) => b[1].length - a[1].length);

  await i.message.edit({
    components: [new ContainerBuilder().setAccentColor(C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🗳️ Ray giri\nFaghat zende-ha ray midan. Har kas yek ray — avaz kardan azad e.`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        ranked.length
          ? ranked.map(([target, voters]) =>
              `${voters.length >= majority ? '⚠️' : '▫️'} **${voters.length}** → <@${target}>\n-# ${voters.map(v => `<@${v}>`).join(' ')}`,
            ).join('\n') + `\n\n-# Aksariat: ${majority} az ${alive}`
          : '-# Hanooz kesi ray nadade.'))
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(enc('ballot', ev.id))
          .setPlaceholder('Ray et ro bede')
          .addOptions(roster.filter(p => p.alive).slice(0, 25).map(p =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${p.seat ?? '?'} · ${(p.userTag ?? p.userId).slice(0, 60)}`)
              .setValue(p.userId)))))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('closevote', ev.id)).setLabel('Bastane ray giri')
          .setEmoji('🔒').setStyle(ButtonStyle.Danger)))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function closeVote(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const votes = (ev.state as { votes?: Record<string, string> }).votes ?? {};
  const tally = new Map<string, number>();
  for (const target of Object.values(votes)) tally.set(target, (tally.get(target) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const tied = ranked.filter(r => r[1] === top?.[1]).length > 1;

  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        top && !tied
          ? `## 🗳️ Ray giri baste shod\nBishtarin ray: <@${top[0]}> ba **${top[1]}** ray.\n-# Tasmim ba gardanande ast.`
          : top && tied
            ? `## 🗳️ Ray giri baste shod\n**Mosavi** — chand nafar ${top[1]} ray daran.\n-# Tasmim ba gardanande ast.`
            : '## 🗳️ Ray giri baste shod\nHich ray-i sabt nashod.'))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}
