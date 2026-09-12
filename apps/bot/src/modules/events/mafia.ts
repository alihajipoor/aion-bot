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
  killPlayer, revivePlayer, type EventRow, type PlayerRow,
} from './store.js';
import {
  SCENARIOS, CITIZEN, scenarioOf, distribution, MAFIA_DEFAULTS, nightActionFor,
  type RoleDef, type MafiaConfig,
} from './games.js';
import { hasRole } from '../../lib/roles.js';

const log = logger('mafia');
export const MAFIA_ID = 'mf';
const enc = (...p: (string | number)[]) => [MAFIA_ID, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const C = { night: 0x2b2d5c, day: 0xfee75c, mafia: 0xed4245, town: 0x57f287 } as const;

/**
 * The day runs in three stages, the way a گرداننده actually runs it:
 *
 *   ejma     everyone accuses as many people as they like; nobody dies
 *   defense  each accused gets the floor, one at a time
 *   final    a single vote, and only the accused are on the ballot
 *
 * No stage closes on a timer. The narrator ends each one, because the room
 * decides when it has heard enough — not a clock.
 */
/** What each role-holder pointed at tonight, keyed by their user id. */
interface NightPick { role: string; target: string; at: number }

interface DayState {
  nightPicks?: Record<string, NightPick>;
  ejma?: { votes: Record<string, string[]>; messageId?: string; open?: boolean };
  nominees?: string[];
  defense?: { order: string[]; at: number; until?: number };
  votes?: Record<string, string>;
  voteMessageId?: string;
  voteOpen?: boolean;
}

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
  const state = ev.state as { phase?: string; night?: number } & DayState;
  const phase = state.phase ?? 'setup';
  const nominees = state.nominees ?? [];

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

  // What the roles pointed at tonight. The narrator still decides what any of
  // it does — the bot only collects, so nobody has to remember six answers
  // while eight people talk over each other.
  const picks = Object.entries(state.nightPicks ?? {});
  if (phase === 'night') {
    const acting = roster.filter(p => p.alive && nightActionFor(p.role));
    box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `### 🌙 Karhaye shab  ·  ${picks.length}/${acting.length}`,
        ...acting.map(p => {
          const pick = state.nightPicks?.[p.userId];
          const target = pick ? roster.find(t => t.userId === pick.target) : null;
          return pick
            ? `✅ **${roleOf(p.role).fa}** <@${p.userId}> → <@${pick.target}>`
              + (target?.role === 'godfather' && p.role === 'detective' ? '  -# (shahrvand didesh)' : '')
            : `⏳ **${roleOf(p.role).fa}** <@${p.userId}> — hanooz entekhab nakarde`;
        }),
      ].join('\n')));
  }

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('phase', ev.id, 'night')).setLabel('Shab').setEmoji('🌙')
      .setStyle(phase === 'night' ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(phase === 'night'),
    new ButtonBuilder().setCustomId(enc('phase', ev.id, 'day')).setLabel('Rooz').setEmoji('☀️')
      .setStyle(phase === 'day' ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(phase === 'day'),
    new ButtonBuilder().setCustomId(enc('ejma', ev.id)).setLabel('Ejma').setEmoji('🖐️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(enc('defense', ev.id)).setLabel('Defa').setEmoji('🗣️')
      .setStyle(ButtonStyle.Primary).setDisabled(!nominees.length),
    new ButtonBuilder().setCustomId(enc('vote', ev.id)).setLabel('Ray giri').setEmoji('🗳️')
      .setStyle(ButtonStyle.Danger).setDisabled(!nominees.length),
  ));

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'inquiry')).setLabel('Estelam').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'kill')).setLabel('Bokosh').setEmoji('💀').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'revive')).setLabel('Zende kon').setEmoji('❤️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('refresh', ev.id)).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  ));

  box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      nominees.length
        ? `-# Roo miz: ${nominees.map(id => `<@${id}>`).join(' · ')}  —  Defa va bad Ray giri.`
        : '-# Ejma aval: hame har chand nafar ke bekhan ray midan, kesi hazf nemishe.'));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

const canRun = (i: MessageComponentInteraction, ev: EventRow): boolean => {
  const m = i.member as GuildMember;
  return i.user.id === ev.hostId
    || m.permissions.has(PermissionFlagsBits.Administrator)
    || hasRole(m, ['Consultant', 'PowerAdmin', 'Dev']);
};

export async function mafiaComponent(i: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const [step, idRaw, arg] = dec(i.customId);
  const id = Number(idRaw);
  const ev = await getEvent(id);
  if (!ev) { await i.reply({ content: 'Event peyda nashod.', flags: MessageFlags.Ephemeral }); return; }

  // Players vote; everything else is the narrator's.
  if (step === 'ballot' && i.isStringSelectMenu()) { await castVote(i, ev); return; }
  if (step === 'ejmavote' && i.isStringSelectMenu()) { await castEjma(i, ev); return; }
  if (step === 'night' && i.isStringSelectMenu()) { await recordNightPick(i, ev); return; }

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

    let note = `${phase === 'night' ? 'Shab' : 'Rooz'} shod — ${touched} nafar mute/unmute shodan.`;
    if (phase === 'night') {
      const sent = await promptNightActions(i.guild!, fresh);
      note += sent.failed.length
        ? `\n> ${sent.ok} naghsh DM shodan. **DM baste:** ${sent.failed.map(f => `<@${f}>`).join(' ')} — dasti azashoon bepors.`
        : `\n> ${sent.ok} naghsh e shabane DM shodan.`;
    }
    await i.update(await console_((await getEvent(ev.id))!, note));
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

  if (step === 'ejma' && i.isButton()) { await openEjma(i, ev); return; }
  if (step === 'ejmaend' && i.isButton()) { await endEjma(i, ev); return; }
  if (step === 'nominate' && i.isStringSelectMenu()) { await setNominees(i, ev); return; }
  if (step === 'defense' && i.isButton()) { await advanceDefense(i, ev); return; }
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

/* ── night actions ─────────────────────────────────────────────── */

/**
 * DMs every living role-holder their night choice.
 *
 * A DM is the only surface with no leak: no channel to mis-permission, no
 * ephemeral reply tied to a message others can see, and they can answer from a
 * phone without leaving voice. Iranian accounts very often have DMs closed
 * though, so the narrator is told exactly who could not be reached and falls
 * back to asking them out loud — the console's own buttons still work.
 */
async function promptNightActions(
  guild: Guild, ev: EventRow,
): Promise<{ ok: number; failed: string[] }> {
  const roster = await players(ev.id);
  const alive = roster.filter(p => p.alive);
  const night = (ev.state as { night?: number }).night ?? 1;

  await mergeState(ev.id, { nightPicks: {} });

  let ok = 0;
  const failed: string[] = [];

  for (const p of alive) {
    const action = nightActionFor(p.role);
    if (!action) continue;

    const targets = alive.filter(t => action.allowSelf || t.userId !== p.userId);
    if (!targets.length) continue;

    const member = guild.members.cache.get(p.userId);
    const sent = await member?.send({
      components: [new ContainerBuilder().setAccentColor(C.night)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## 🌙 Shab ${night} — ${action.label}\n${action.prompt}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `-# Naghshe to: **${roleOf(p.role).fa}** · ta sobh mitooni avazesh koni.`))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId(enc('night', ev.id, p.role ?? ''))
            .setPlaceholder(action.prompt.slice(0, 100))
            .addOptions(targets.slice(0, 25).map(t =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${t.seat ?? '?'} · ${(t.userTag ?? t.userId).slice(0, 60)}`)
                .setValue(t.userId)))))],
      flags: MessageFlags.IsComponentsV2,
    }).then(() => true).catch(() => false);

    if (sent) ok++;
    else { failed.push(p.userId); log.warn(`night DM failed for ${p.userTag} (${p.role})`); }
  }

  return { ok, failed };
}

/** A role-holder answering their night prompt in DM. */
async function recordNightPick(i: StringSelectMenuInteraction, ev: EventRow): Promise<void> {
  const roster = await players(ev.id);
  const me = roster.find(p => p.userId === i.user.id);
  if (!me?.alive) { await i.reply({ content: 'To dige too baazi nisti.', flags: MessageFlags.Ephemeral }); return; }

  const phase = (ev.state as { phase?: string }).phase;
  if (phase !== 'night') { await i.reply({ content: 'Shab tamoom shode.', flags: MessageFlags.Ephemeral }); return; }

  const action = nightActionFor(me.role);
  if (!action) return;

  const target = i.values[0]!;
  const picks = { ...((ev.state as DayState).nightPicks ?? {}) };
  picks[i.user.id] = { role: me.role ?? '', target, at: Date.now() };
  await mergeState(ev.id, { nightPicks: picks });

  // The detective is answered on the spot. Everyone else's choice goes to the
  // narrator, who still decides what the night actually does.
  if (action.answersActor) {
    const t = roster.find(p => p.userId === target);
    // The Godfather reads as a citizen — the point of the scenario.
    const shown = t?.role === 'godfather' ? 'town' : t?.side;
    await i.update({
      components: [new ContainerBuilder().setAccentColor(shown === 'mafia' ? C.mafia : C.town)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## 🔍 Natijeye estelam\n<@${target}> → **${shown === 'mafia' ? 'مافیا' : 'شهروند'}**`))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '-# Faghat to in ro didi. Ta sobh mitooni yeki dige ro estelam koni.'))
        // The menu is rebuilt rather than reused: they may change their mind
        // until the narrator calls morning, and the answer updates with it.
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId(enc('night', ev.id, me.role ?? ''))
            .setPlaceholder('Yeki dige ro estelam kon')
            .addOptions(roster.filter(p => p.alive && p.userId !== i.user.id).slice(0, 25).map(t =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${t.seat ?? '?'} · ${(t.userTag ?? t.userId).slice(0, 60)}`)
                .setValue(t.userId)
                .setDefault(t.userId === target)))))],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
    return;
  }

  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.night)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ✅ Sabt shod\n${action.label} → <@${target}>`))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '-# Gardanande in ro mibine. Ta sobh mitooni avazesh koni.'))],
    flags: MessageFlags.IsComponentsV2,
  }).catch(() => {});
}

/* ── stage 1: ejma, the accusation round ──────────────────────── */

const chatOf = (ev: EventRow, guild: Guild): TextChannel | undefined =>
  ev.textChannelId ? guild.channels.cache.get(ev.textChannelId) as TextChannel | undefined : undefined;

function ejmaCard(ev: EventRow, alive: PlayerRow[], open: boolean) {
  const st = ev.state as DayState;
  const votes = st.ejma?.votes ?? {};

  const tally = new Map<string, string[]>();
  for (const [voter, targets] of Object.entries(votes)) {
    for (const t of targets) tally.set(t, [...(tally.get(t) ?? []), voter]);
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1].length - a[1].length);

  const box = new ContainerBuilder().setAccentColor(C.day)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      open
        ? '## 🖐️ Ejma\nHar chand nafar ke mikhay entekhab kon — yeki, se ta, hame. Kesi ba in ray hazf nemishe.'
        : '## 🖐️ Ejma — baste shod'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      ranked.length
        ? ranked.map(([target, voters]) =>
            `**${voters.length}** → <@${target}>\n-# ${voters.map(v => `<@${v}>`).join(' ')}`).join('\n')
        : '-# Hanooz kesi ray nadade.'));

  if (open) {
    box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(enc('ejmavote', ev.id))
        .setPlaceholder('Har chand nafar ke mikhay')
        .setMinValues(0).setMaxValues(Math.max(1, Math.min(25, alive.length)))
        .addOptions(alive.slice(0, 25).map(p =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${p.seat ?? '?'} · ${(p.userTag ?? p.userId).slice(0, 60)}`)
            .setValue(p.userId)
            .setDefault((votes[''] ?? []).includes(p.userId))))))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('ejmaend', ev.id)).setLabel('Bastane ejma')
          .setEmoji('🔒').setStyle(ButtonStyle.Danger)));
  }

  return {
    components: [box],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] as never[] },
  };
}

async function openEjma(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const ch = chatOf(ev, i.guild!);
  if (!ch) { await i.reply({ content: 'Channel e chat peyda nashod.', flags: MessageFlags.Ephemeral }); return; }

  await mergeState(ev.id, { ejma: { votes: {}, open: true }, nominees: [], defense: undefined });
  const fresh = (await getEvent(ev.id))!;
  const alive = await alivePlayers(ev.id);

  const msg = await ch.send(ejmaCard(fresh, alive, true));
  await mergeState(ev.id, { ejma: { votes: {}, open: true, messageId: msg.id } });
  await i.reply({ content: `Ejma baz shod too <#${ch.id}>. Ba dokme khodet mibandi.`, flags: MessageFlags.Ephemeral });
}

async function castEjma(i: StringSelectMenuInteraction, ev: EventRow): Promise<void> {
  const st = ev.state as DayState;
  if (!st.ejma?.open) { await i.reply({ content: 'Ejma baste shode.', flags: MessageFlags.Ephemeral }); return; }

  const roster = await players(ev.id);
  const me = roster.find(p => p.userId === i.user.id);
  if (!me?.alive) { await i.reply({ content: 'Faghat bazikon-haye zende ray midan.', flags: MessageFlags.Ephemeral }); return; }

  await i.deferUpdate();
  const votes = { ...st.ejma.votes, [i.user.id]: i.values };
  await mergeState(ev.id, { ejma: { ...st.ejma, votes } });

  const fresh = (await getEvent(ev.id))!;
  await i.message.edit(ejmaCard(fresh, roster.filter(p => p.alive), true)).catch(() => {});
}

/** Ends accusations and asks the narrator to confirm who goes to defence. */
async function endEjma(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const st = ev.state as DayState;
  const votes = st.ejma?.votes ?? {};
  const roster = await players(ev.id);
  const alive = roster.filter(p => p.alive);

  const counts = new Map<string, number>();
  for (const targets of Object.values(votes)) {
    for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const top = Math.max(0, ...counts.values());
  // Everyone level with the highest count is the natural slate; the narrator
  // can still add or drop names before defence begins.
  const suggested = [...counts.entries()].filter(([, n]) => n === top && n > 0).map(([id]) => id);

  await mergeState(ev.id, { ejma: { ...(st.ejma ?? { votes: {} }), open: false } });
  const fresh = (await getEvent(ev.id))!;
  await i.message.edit(ejmaCard(fresh, alive, false)).catch(() => {});

  await i.reply({
    components: [new ContainerBuilder().setAccentColor(C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### 🗣️ Ki bere roo miz?\n${suggested.length
          ? `Bishtarin ray: ${suggested.map(id => `<@${id}>`).join(' · ')} (${top} ray)`
          : 'Hich ray-i sabt nashod — khodet entekhab kon.'}`))
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(enc('nominate', ev.id))
          .setPlaceholder('Kasaani ke defa mikonan')
          .setMinValues(1).setMaxValues(Math.max(1, Math.min(25, alive.length)))
          .addOptions(alive.slice(0, 25).map(p =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${p.seat ?? '?'} · ${(p.userTag ?? p.userId).slice(0, 60)}`)
              .setDescription(`${counts.get(p.userId) ?? 0} ray`)
              .setValue(p.userId)
              .setDefault(suggested.includes(p.userId))))))],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

/* ── stage 2: defence ─────────────────────────────────────────── */

async function setNominees(i: StringSelectMenuInteraction, ev: EventRow): Promise<void> {
  await mergeState(ev.id, { nominees: i.values, defense: { order: i.values, at: -1 } });
  const fresh = (await getEvent(ev.id))!;

  const ch = chatOf(fresh, i.guild!);
  await ch?.send({
    components: [new ContainerBuilder().setAccentColor(C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🗣️ Roo miz\n${i.values.map((id, n) => `\`${n + 1}\` <@${id}>`).join('\n')}`))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '-# Be tartib defa mikonan. Gardanande nobat ro rad mikone.'))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch(() => {});

  await i.update(await console_(fresh, `${i.values.length} nafar rafan roo miz.`));
}

/** Hands the floor to the next nominee, or reports that everyone has spoken. */
async function advanceDefense(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const st = ev.state as DayState;
  const order = st.defense?.order ?? st.nominees ?? [];
  if (!order.length) { await i.reply({ content: 'Aval ejma ro tamoom kon.', flags: MessageFlags.Ephemeral }); return; }

  const at = (st.defense?.at ?? -1) + 1;
  const cfg = configOf(ev);
  const ch = chatOf(ev, i.guild!);

  if (at >= order.length) {
    await ch?.send({
      components: [new ContainerBuilder().setAccentColor(C.day)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '## ✅ Defa ha tamoom shod\nHala ray giri.'))],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
    await i.update(await console_(ev, 'Hameye defa ha anjam shod — Ray giri bezan.'));
    return;
  }

  const until = Math.floor((Date.now() + cfg.defenseSeconds * 1000) / 1000);
  await mergeState(ev.id, { defense: { order, at, until } });

  await ch?.send({
    components: [new ContainerBuilder().setAccentColor(C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🗣️ Nobate <@${order[at]}>\n\`${at + 1}\` az \`${order.length}\` · vaght ta <t:${until}:R>`))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [order[at]!] },
  }).catch(() => {});

  const fresh = (await getEvent(ev.id))!;
  await i.update(await console_(fresh, `Nobate defa: <@${order[at]}> (${at + 1}/${order.length}).`));
}

/* ── stage 3: the final vote, nominees only ───────────────────── */

function finalCard(ev: EventRow, nominees: PlayerRow[], aliveCount: number, open: boolean) {
  const st = ev.state as DayState;
  const votes = st.votes ?? {};
  const tally = new Map<string, string[]>();
  for (const [voter, target] of Object.entries(votes)) {
    tally.set(target, [...(tally.get(target) ?? []), voter]);
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1].length - a[1].length);
  const majority = Math.floor(aliveCount / 2) + 1;

  const box = new ContainerBuilder().setAccentColor(open ? C.day : C.mafia)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      open
        ? '## 🗳️ Ray giri\nFaghat kasaani ke defa kardan roo ballot an. Yek ray har nafar.'
        : '## 🗳️ Ray giri — baste shod'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      ranked.length
        ? ranked.map(([target, voters]) =>
            `${voters.length >= majority ? '⚠️' : '▫️'} **${voters.length}** → <@${target}>\n-# ${voters.map(v => `<@${v}>`).join(' ')}`,
          ).join('\n') + `\n\n-# Aksariat: ${majority} az ${aliveCount}`
        : '-# Hanooz kesi ray nadade.'));

  if (open) {
    box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(enc('ballot', ev.id))
        .setPlaceholder('Ray et ro bede')
        .addOptions(nominees.slice(0, 25).map(p =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${p.seat ?? '?'} · ${(p.userTag ?? p.userId).slice(0, 60)}`)
            .setValue(p.userId)))))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('closevote', ev.id)).setLabel('Bastane ray giri')
          .setEmoji('🔒').setStyle(ButtonStyle.Danger)));
  }

  return {
    components: [box],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] as never[] },
  };
}

async function openVote(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const ch = chatOf(ev, i.guild!);
  if (!ch) { await i.reply({ content: 'Channel e chat peyda nashod.', flags: MessageFlags.Ephemeral }); return; }

  const st = ev.state as DayState;
  const ids = st.nominees ?? [];
  if (!ids.length) { await i.reply({ content: 'Aval ejma va defa.', flags: MessageFlags.Ephemeral }); return; }

  const roster = await players(ev.id);
  const nominees = roster.filter(p => ids.includes(p.userId));
  const alive = roster.filter(p => p.alive).length;

  await mergeState(ev.id, { votes: {}, voteOpen: true });
  const fresh = (await getEvent(ev.id))!;
  const msg = await ch.send(finalCard(fresh, nominees, alive, true));
  await mergeState(ev.id, { voteMessageId: msg.id });
  await i.reply({ content: `Ray giri baz shod too <#${ch.id}>. Ba dokme khodet mibandi.`, flags: MessageFlags.Ephemeral });
}

async function castVote(i: StringSelectMenuInteraction, ev: EventRow): Promise<void> {
  const st = ev.state as DayState;
  if (!st.voteOpen) { await i.reply({ content: 'Ray giri baste shode.', flags: MessageFlags.Ephemeral }); return; }

  const roster = await players(ev.id);
  const me = roster.find(p => p.userId === i.user.id);
  if (!me?.alive) { await i.reply({ content: 'Faghat bazikon-haye zende ray midan.', flags: MessageFlags.Ephemeral }); return; }

  await i.deferUpdate();
  const votes = { ...(st.votes ?? {}), [i.user.id]: i.values[0]! };
  await mergeState(ev.id, { votes });

  const fresh = (await getEvent(ev.id))!;
  const ids = (fresh.state as DayState).nominees ?? [];
  await i.message.edit(finalCard(fresh, roster.filter(p => ids.includes(p.userId)), roster.filter(p => p.alive).length, true))
    .catch(() => {});
}

async function closeVote(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const st = ev.state as DayState;
  const votes = st.votes ?? {};
  const counts = new Map<string, number>();
  for (const t of Object.values(votes)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const tied = ranked.filter(r => r[1] === top?.[1]).length > 1;

  await mergeState(ev.id, { voteOpen: false });
  const fresh = (await getEvent(ev.id))!;
  const roster = await players(ev.id);
  const ids = (fresh.state as DayState).nominees ?? [];

  await i.update(finalCard(fresh, roster.filter(p => ids.includes(p.userId)), roster.filter(p => p.alive).length, false));

  const ch = chatOf(fresh, i.guild!);
  await ch?.send({
    components: [new ContainerBuilder().setAccentColor(C.mafia)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        top && !tied
          ? `## 🗳️ Natije\nBishtarin ray: <@${top[0]}> ba **${top[1]}** ray.\n-# Tasmime akhar ba gardanande ast — ba Bokosh anjam bede.`
          : top && tied
            ? `## 🗳️ Mosavi\nChand nafar ${top[1]} ray daran. Tasmim ba gardanande.`
            : '## 🗳️ Hich ray-i sabt nashod.'))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch(() => {});
}
