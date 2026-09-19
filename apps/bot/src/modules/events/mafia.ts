import {
  ChannelType, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, PermissionFlagsBits,
  type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction,
  type MessageComponentInteraction, type Guild, type GuildMember, type TextChannel,
  type MessageReaction, type PartialMessageReaction,
} from 'discord.js';
import { isolate, num } from '../../lib/text.js';
import { logger } from '../../lib/log.js';
import {
  getEvent, patchEvent, mergeState, players, alivePlayers, assignRole,
  killPlayer, revivePlayer, liveEvents, type EventRow, type PlayerRow,
} from './store.js';
import {
  SCENARIOS, CITIZEN, scenarioOf, distribution, explicitDistribution,
  MAFIA_DEFAULTS, nightActionFor, passiveFor,
  type RoleDef, type MafiaConfig, type NightAction, type Phase, type TextRule,
} from './games.js';
import { hasRole } from '../../lib/roles.js';
import { postMafiaHistory } from '../mafiaHistory.js';
import { SETUP_ID, setupButton, setupComponent, setTextRuleApplier } from './setupPanel.js';

const log = logger('mafia');
/**
 * The prefix events/index.ts routes on. setupPanel mints its own custom ids
 * under the same prefix and cannot import this constant without closing an
 * import cycle, so the two are tied together by type: change one and the build
 * fails, rather than every Tanzimat button going quietly dead in a live game.
 */
export const MAFIA_ID: typeof SETUP_ID = 'mf';
const enc = (...p: (string | number)[]) => [MAFIA_ID, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const C = { night: 0x2b2d5c, day: 0xfee75c, mafia: 0xed4245, town: 0x57f287 } as const;

/**
 * The day runs in three stages, the way a گرداننده actually runs it:
 *
 *   ejma     the first ballot: everyone accuses as many people as they like
 *            and nobody dies. Shown in the room as "Ray giri avval" — the
 *            name "Ejma" belongs to the final vote below.
 *   defense  each accused gets the floor, one at a time
 *   final    a single vote, and only the accused are on the ballot
 *
 * No stage closes on a timer. The narrator ends each one, because the room
 * decides when it has heard enough — not a clock.
 */
/** What each role-holder pointed at tonight, keyed by their user id. */
interface NightPick { role: string; target: string; at: number; variant?: string }

interface DayState {
  nightPicks?: Record<string, NightPick>;
  /** Nights a limited ability has been spent, and self-targets used. */
  uses?: Record<string, number>;
  selfUses?: Record<string, number>;
  /**
   * The FIRST ballot — the accusation round that picks who defends.
   *
   * The key is a misnomer kept on purpose: renaming it would have to migrate
   * the state of every game already in flight. In the room, "Ejma" is the
   * *final* vote and this one is "Ray giri avval". Read the labels, not the
   * key.
   */
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

/**
 * The host's wizard choices, with defaults for events drafted before it.
 *
 * Exported because the Scum console reads the same blob — one accessor, so the
 * two modes cannot disagree about what a missing key defaults to.
 */
export function configOf(ev: EventRow): MafiaConfig {
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

/* ── text control ──────────────────────────────────────────────── */

/**
 * What the game's text channel allows right now.
 *
 * Permissions do the work rather than a message listener, because a deny is
 * enforced by Discord before the message exists — there is no window where
 * something lands and is deleted a second later, and nothing to race.
 *
 * The phase that matters is the vote. With the channel shut, the ballot is the
 * only way to vote; a parallel argument in chat while the vote is open is how a
 * result gets disputed afterwards.
 */
export async function applyTextRules(
  guild: Guild, ev: EventRow, phase: Phase,
): Promise<TextRule | null> {
  if (!ev.textChannelId) return null;
  const channel = guild.channels.cache.get(ev.textChannelId);
  // Threads are text-based but carry no overwrites of their own, so narrow to
  // the real channel rather than trusting isTextBased().
  if (channel?.type !== ChannelType.GuildText) return null;

  const rule = configOf(ev).textRules[phase] ?? 'free';
  const can = (send: boolean, react: boolean) =>
    channel.permissionOverwrites.edit(guild.roles.everyone.id, {
      SendMessages: send, AddReactions: react,
      SendMessagesInThreads: send, CreatePublicThreads: send,
    }, { reason: `AION mafia — ${phase}: ${rule}` })
      .catch((e: Error) => log.warn(`text rule ${rule} failed: ${e.message}`));

  if (rule === 'free') await can(true, true);
  else if (rule === 'reactions' || rule === 'emoji') await can(false, true);
  else await can(false, false);

  await mergeState(ev.id, { textPhase: phase });
  return rule;
}

// The settings panel re-applies the live phase's rule the moment God changes
// it. It cannot import this function back without a cycle, so it is handed in.
setTextRuleApplier(applyTextRules);

/**
 * Strips reactions a phase does not allow.
 *
 * Discord cannot restrict *which* emoji a permission allows, only whether
 * reactions are possible at all — so the `emoji` rule is the one policy that
 * has to be enforced after the fact rather than before it.
 */
export function installMafiaReactionGuard(client: { on: (e: string, f: (...a: unknown[]) => void) => unknown }): void {
  client.on('messageReactionAdd', (...args: unknown[]) => {
    void (async () => {
      const reaction = args[0] as MessageReaction | PartialMessageReaction;
      const user = args[1] as { bot?: boolean; id: string };
      if (user.bot) return;
      const channelId = reaction.message.channelId;
      const guild = reaction.message.guild;
      if (!guild) return;

      const live = await liveEvents(guild.id).catch(() => []);
      const ev = live.find(e => e.game === 'mafia' && e.textChannelId === channelId);
      if (!ev) return;

      const cfg = configOf(ev);
      const phase = (ev.state as { textPhase?: Phase }).textPhase;
      if (!phase || cfg.textRules[phase] !== 'emoji') return;

      const name = reaction.emoji.name ?? '';
      if (cfg.allowedEmoji.includes(name)) return;
      await reaction.users.remove(user.id).catch(() => {});
    })();
  });
  log.info('mafia reaction guard installed');
}

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
    // A hand-mute outranks the phase: God asked for quiet and the clock does
    // not get a vote. Sticky, or the next phase change would quietly undo it
    // and the room would start talking again on its own.
    const forced = (ev.state as { forceMute?: boolean }).forceMute === true;
    const shouldMute = forced
      || (phase === 'night' && cfg.autoMuteNight)
      || (!p.alive && cfg.deadStayMuted);
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
  /*
   * God's own numbers win over the scenario's ladder.
   *
   * Tanzimat wrote these and, until now, this line threw them away — the panel
   * let a host set three of a role and then dealt the fixed order anyway, which
   * is worse than not offering the control at all.
   */
  const cast = explicitDistribution(sc, roster.length, cfg.roleCounts ?? {});
  const roles = shuffle(cast ?? distribution(sc, roster.length, cfg.optionalRoles));
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
    /*
     * ViewChannel is not enough on its own.
     *
     * ReadMessageHistory is a separate permission, and a member overwrite that
     * grants the first without the second produces a channel you can open and
     * cannot read: "You do not have permission to view the message history".
     * It bit the narrator mid-game, in a room whose whole purpose is the
     * conversation already in it.
     */
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: guild.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory] },
      { id: ev.hostId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory] },
      ...mafiaIds.map(id => ({
        id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory],
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
          const action = nightActionFor(p.role);
          const left = action ? usesLeft(ev, p.userId, action) : null;
          const budget = left !== null ? `  -# (${left} bar dige)` : '';
          return pick
            ? `✅ **${roleOf(p.role).fa}** <@${p.userId}> → <@${pick.target}>`
              + (pick.variant ? ` · **${pick.variant}**` : '')
              + (target?.role === 'godfather' && p.role === 'detective' ? '  -# (shahrvand didesh)' : '')
            : `⏳ **${roleOf(p.role).fa}** <@${p.userId}> — hanooz entekhab nakarde${budget}`;
        }),
      ].join('\n')));
  }

  // Passives have no button to press; they are facts that decide whether a
  // shot lands, and forgetting one mid-night is how a game goes wrong.
  const passives = roster.filter(p => p.alive && passiveFor(p.role));
  if (passives.length && phase !== 'setup') {
    box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        '### 🧠 Yadet bashe',
        ...passives.map(p => `**${roleOf(p.role).fa}** <@${p.userId}>\n-# ${passiveFor(p.role)}`),
      ].join('\n')));
  }

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('phase', ev.id, 'night')).setLabel('Shab').setEmoji('🌙')
      .setStyle(phase === 'night' ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(phase === 'night'),
    new ButtonBuilder().setCustomId(enc('phase', ev.id, 'day')).setLabel('Rooz').setEmoji('☀️')
      .setStyle(phase === 'day' ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(phase === 'day'),
    new ButtonBuilder().setCustomId(enc('ejma', ev.id)).setLabel('Ray giri avval')
      .setEmoji('🖐️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(enc('defense', ev.id)).setLabel('Defa').setEmoji('🗣️')
      .setStyle(ButtonStyle.Primary).setDisabled(!nominees.length),
    new ButtonBuilder().setCustomId(enc('vote', ev.id)).setLabel('Ejma').setEmoji('🗳️')
      .setStyle(ButtonStyle.Danger).setDisabled(!nominees.length),
  ));

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'inquiry')).setLabel('Estelam').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'kill')).setLabel('Bokosh').setEmoji('💀').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'revive')).setLabel('Zende kon').setEmoji('❤️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('refresh', ev.id)).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    setupButton(ev.id),
  ));

  // The overrides. Every rule this bot enforces can be wrong about a situation
  // nobody anticipated, and a game that cannot be rescued by hand is a game that
  // ends in an argument. These are the escape hatches.
  /*
   * The hand-mute is always on the console, including before Shoroo — just
   * disabled until there is a voice channel to mute, which only exists once the
   * game starts. Hiding it until then meant looking for it and concluding it
   * had never been built.
   */
  const muted = (ev.state as { forceMute?: boolean }).forceMute === true;
  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('hush', ev.id))
      .setLabel(muted ? 'Baz kon' : 'Hame ro mute kon')
      .setEmoji(muted ? '🔊' : '🔇')
      .setStyle(muted ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!ev.voiceChannelId),
    ...(phase === 'setup' ? [] : [
      new ButtonBuilder().setCustomId(enc('win', ev.id, 'mafia')).setLabel('Mafia bord')
        .setEmoji('🔴').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(enc('win', ev.id, 'shahr')).setLabel('Shahr bord')
        .setEmoji('🟢').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(enc('mvp', ev.id)).setLabel('MVP')
        .setEmoji('⭐').setStyle(ButtonStyle.Secondary),
    ]),
  ));

  if (phase !== 'setup') {
    const alive = roster.filter(p => p.alive);
    const mafiaN = alive.filter(p => p.side === 'mafia').length;
    const shahrN = alive.length - mafiaN;
    box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# Zende: 🔴 **${num(mafiaN)}** mafia · 🟢 **${num(shahrN)}** shahr` +
        (mafiaN && mafiaN >= shahrN ? '  —  **mafia be tasavi reside**' : '')));
  }

  box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      nominees.length
        ? `-# Roo miz: ${nominees.map(id => `<@${id}>`).join(' · ')}`
          + '  —  Defa mikonan, bad **Ejma** (ray-e payani).'
        : '-# **Ray giri-ye avval**: har kas har chand nafar ke bekhad ray mide, kesi hazf nemishe.'
          + '\n-# Moshakhas mikone ki defa kone. Hazf toye **Ejma** — ray-e payani — ettefagh mioftad.'));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

const canRun = (i: MessageComponentInteraction, ev: EventRow): boolean => {
  const m = i.member as GuildMember;
  return i.user.id === ev.hostId
    || m.permissions.has(PermissionFlagsBits.Administrator)
    || hasRole(m, ['Consultant', 'PowerAdmin', 'Dev']);
};

/**
 * How this module asks for the whole event to be torn down.
 *
 * events/index.ts already imports this file, so importing it back would make a
 * cycle. It hands its finisher in at install time instead.
 */
type Finisher = (guild: Guild, ev: EventRow, reason: string) => Promise<void>;
let finishEvent: Finisher | null = null;
export const setEventFinisher = (fn: Finisher): void => { finishEvent = fn; };

/**
 * Ends the game on God's word.
 *
 * The bot deliberately never decides this itself: Natasha counts as mafia
 * without being on the mafia team and the Traitor counts as shahr while
 * possibly winning with them, so an automatic parity check has edge cases — and
 * an edge case firing mid-game ruins that game for everyone in it.
 */
async function declareWin(
  i: ButtonInteraction, ev: EventRow, winner: 'mafia' | 'shahr',
): Promise<void> {
  await i.deferUpdate();
  const roster = await players(ev.id).catch(() => []);
  const mvpId = (ev.state as { mvpId?: string }).mvpId ?? null;
  await mergeState(ev.id, { winner, endedBy: i.user.id });

  const announce = [
    `# ${winner === 'mafia' ? '🔴 Mafia bord' : '🟢 Shahr bord'}`,
    '',
    ...roster.map(p => `${p.side === 'mafia' ? '🔴' : '🟢'} <@${p.userId}> — **${roleOf(p.role).fa}**`),
    ...(mvpId ? ['', `⭐ **MVP:** <@${mvpId}>`] : []),
  ].join('\n');

  const channel = i.guild?.channels.cache.get(ev.textChannelId ?? '');
  if (channel?.isTextBased()) {
    await channel.send({ content: announce, allowedMentions: { parse: [] } }).catch(() => {});
  }

  // Recorded before teardown: it deletes the channels this roster came from,
  // and a failure after that point is one nobody can reconstruct.
  if (i.guild) {
    await postMafiaHistory(i.guild, {
      guildId: i.guild.id, eventId: ev.id, mode: 'irani', winner, mvpUserId: mvpId,
      players: roster.map(p => ({
        userId: p.userId, role: p.role, roleFa: roleOf(p.role).fa, side: p.side,
      })),
    }).catch(e => log.error('mafia history failed', e));
  }

  const fresh = (await getEvent(ev.id))!;
  if (finishEvent && i.guild) await finishEvent(i.guild, fresh, `AION mafia — ${winner} bord`);
}

export async function mafiaComponent(i: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const [step, idRaw, arg] = dec(i.customId);
  const id = Number(idRaw);
  const ev = await getEvent(id);
  if (!ev) { await i.reply({ content: 'Event peyda nashod.', flags: MessageFlags.Ephemeral }); return; }

  // Players vote; everything else is the narrator's.
  if (step === 'ballot' && i.isStringSelectMenu()) { await castVote(i, ev); return; }
  if (step === 'ejmavote' && i.isStringSelectMenu()) { await castEjma(i, ev); return; }
  if (step === 'night' && i.isStringSelectMenu()) { await recordNightPick(i, ev); return; }
  if (step === 'variant' && i.isButton()) { await recordVariant(i, ev, arg ?? '0'); return; }

  if (!canRun(i, ev)) {
    await i.reply({ content: 'Faghat gardanande.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Tanzimat, in its own file. It opens as a separate ephemeral message rather
  // than taking over the console, so God can tune a rule without losing the
  // phase buttons he is mid-game with.
  if (await setupComponent(i, ev)) return;

  if (step === 'console' || step === 'refresh') {
    const payload = await console_(ev);
    if (step === 'console') await i.reply(payload);
    else await i.update(payload);
    return;
  }

  if (step === 'win' && i.isButton()) {
    await declareWin(i, ev, arg === 'mafia' ? 'mafia' : 'shahr');
    return;
  }

  if (step === 'hush' && i.isButton()) {
    const on = !(ev.state as { forceMute?: boolean }).forceMute;
    await mergeState(ev.id, { forceMute: on });
    const fresh = (await getEvent(ev.id))!;
    const phase = ((fresh.state as { phase?: string }).phase as 'night' | 'day') ?? 'day';
    const touched = await applyVoice(i.guild!, fresh, phase);
    await i.update(await console_(fresh, on
      ? `🔇 Hame mute shodan (${num(touched)} nafar). Ta khodet baz nakoni, mimoonan.`
      : `🔊 Mute bardashte shod (${num(touched)} nafar).`));
    return;
  }

  if (step === 'mvp' && i.isButton()) {
    const roster = await players(ev.id).catch(() => []);
    if (!roster.length) { await i.reply({ content: 'Bazikoni nist.', flags: MessageFlags.Ephemeral }); return; }
    await i.reply({
      content: 'MVP ro entekhab kon:',
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(enc('mvppick', ev.id))
          .setPlaceholder('MVP')
          .addOptions(roster.slice(0, 25).map(p => ({
            label: (i.guild?.members.cache.get(p.userId)?.displayName ?? p.userTag ?? p.userId).slice(0, 100),
            value: p.userId,
          }))))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (step === 'mvppick' && i.isStringSelectMenu()) {
    const pick = i.values[0]!;
    await mergeState(ev.id, { mvpId: pick });
    await i.update({ content: `⭐ MVP: <@${pick}>`, components: [] });
    return;
  }

  if (step === 'phase') {
    const phase = arg as 'night' | 'day';
    const night = phase === 'night' ? ((ev.state as { night?: number }).night ?? 0) + 1 : ((ev.state as { night?: number }).night ?? 1);
    await mergeState(ev.id, { phase, night });
    const fresh = (await getEvent(ev.id))!;
    const touched = await applyVoice(i.guild!, fresh, phase);
    await applyTextRules(i.guild!, fresh, phase);
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

  if (step === 'ejma' && i.isButton()) {
    await applyTextRules(i.guild!, ev, 'ejma');
    await openEjma(i, ev); return;
  }
  if (step === 'ejmaend' && i.isButton()) { await endEjma(i, ev); return; }
  if (step === 'nominate' && i.isStringSelectMenu()) { await setNominees(i, ev); return; }
  if (step === 'defense' && i.isButton()) {
    await applyTextRules(i.guild!, ev, 'defense');
    await advanceDefense(i, ev); return;
  }
  if (step === 'vote' && i.isButton()) {
    // Shut the channel before the ballot opens, not after — a message that
    // lands in the gap is exactly the one that gets argued about later.
    await applyTextRules(i.guild!, ev, 'vote');
    await openVote(i, ev); return;
  }
  if (step === 'closevote' && i.isButton()) {
    await closeVote(i, ev);
    await applyTextRules(i.guild!, ev, 'day');
    return;
  }
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

/** How many nights this ability has left, or null when it is unlimited. */
function usesLeft(ev: EventRow, userId: string, action: NightAction): number | null {
  if (action.uses === undefined) return null;
  const spent = (ev.state as DayState).uses?.[userId] ?? 0;
  return Math.max(0, action.uses - spent);
}

const selfLeft = (ev: EventRow, userId: string, action: NightAction): number =>
  action.selfUses === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, action.selfUses - ((ev.state as DayState).selfUses?.[userId] ?? 0));

/** Who this role may point at tonight, with its own limits applied. */
/**
 * The night menu for one role-holder, with their current choice marked.
 *
 * Built in one place because it is needed in two: when the prompt goes out, and
 * again on every confirmation. The confirmation cards used to be text only,
 * which made "ta sobh mitooni avazesh koni" a lie — `i.update` replaced the
 * message that carried the menu with one that had no menu on it, so the sniper
 * was told he could change his mind and handed nothing to change it with.
 *
 * The detective's branch already rebuilt its menu for exactly this reason. Now
 * every branch does.
 */
const nightRow = (
  ev: EventRow, actor: PlayerRow, action: NightAction,
  targets: PlayerRow[], picked?: string | null,
) => new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
  new StringSelectMenuBuilder().setCustomId(enc('night', ev.id, actor.role ?? ''))
    .setPlaceholder(action.prompt.slice(0, 100))
    .addOptions(targets.slice(0, 25).map(t =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${t.seat ?? '?'} · ${(t.userTag ?? t.userId).slice(0, 60)}`)
        .setValue(t.userId)
        .setDefault(t.userId === picked))));

function legalTargets(ev: EventRow, actor: PlayerRow, roster: PlayerRow[], action: NightAction): PlayerRow[] {
  const alive = roster.filter(p => p.alive);
  const pool = action.targets === 'mafia' ? alive.filter(p => p.side === 'mafia') : alive;
  return pool.filter(t => {
    if (t.userId !== actor.userId) return true;
    return action.allowSelf && selfLeft(ev, actor.userId, action) > 0;
  });
}



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

    const left = usesLeft(ev, p.userId, action);
    if (left === 0) continue;                 // spent; nothing to ask them
    const targets = legalTargets(ev, p, roster, action);
    if (!targets.length) continue;

    const member = guild.members.cache.get(p.userId);
    const sent = await member?.send({
      components: [new ContainerBuilder().setAccentColor(C.night)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## 🌙 Shab ${night} — ${action.label}\n${action.prompt}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          [
            `-# Naghshe to: **${roleOf(p.role).fa}** · ta sobh mitooni avazesh koni.`,
            left !== null ? `-# **${left}** bar dige mitooni estefade koni.` : null,
            action.allowSelf && selfLeft(ev, p.userId, action) > 0 && action.selfUses !== undefined
              ? '-# Khodet ro faghat yek bar mitooni entekhab koni.' : null,
          ].filter(Boolean).join('\n')))
        .addActionRowComponents(nightRow(ev, p, action, targets))],
      flags: MessageFlags.IsComponentsV2,
    }).then(() => true).catch(() => false);

    if (sent) ok++;
    else { failed.push(p.userId); log.warn(`night DM failed for ${p.userTag} (${p.role})`); }
  }

  return { ok, failed };
}

/**
 * Gets an inquiry's answer to the person who asked for it, whatever happened.
 *
 * The detective's whole night is this one sentence, and it used to live inside
 * a `.catch(() => {})` on a single `i.update`. If that update lost the race
 * with Discord's three-second window — which is exactly what was happening —
 * the answer was gone: the use was spent, the pick was recorded, and the
 * detective was simply never told anything.
 *
 * So: a fresh DM if editing the prompt failed, and if DMs are shut, God is
 * given it to pass on by hand. Never nothing.
 */
async function deliverAnswer(
  i: StringSelectMenuInteraction, ev: EventRow, answer: string, colour: number,
): Promise<void> {
  const card = new ContainerBuilder().setAccentColor(colour)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(answer))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Faghat to in ro didi.'));

  const direct = await i.user.send({ components: [card], flags: MessageFlags.IsComponentsV2 })
    .then(() => true).catch(() => false);
  if (direct) return;

  log.warn(`event #${ev.id}: could not deliver an inquiry answer to ${i.user.tag}`);
  const host = await i.guild?.members.fetch(ev.hostId).catch(() => null);
  await host?.send({
    components: [new ContainerBuilder().setAccentColor(colour)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🔍 Javab be dast-e sahebesh nareside\n<@${i.user.id}>\n${answer}`
        + '\n-# DM-esh baste-st. Khodet behesh begoo.'))],
    flags: MessageFlags.IsComponentsV2,
  }).catch(() => {});
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
  const st = ev.state as DayState;
  const already = st.nightPicks?.[i.user.id];

  // Spend a use only on the first pick of the night — changing your mind
  // before morning is free, or a misclick would cost the sniper a bullet.
  const patch: Record<string, unknown> = {};
  if (!already) {
    if (action.uses !== undefined) {
      patch.uses = { ...(st.uses ?? {}), [i.user.id]: (st.uses?.[i.user.id] ?? 0) + 1 };
    }
  }
  /*
   * The self-save is charged for where the night *ends up*, not for every time
   * they touch it.
   *
   * It used to only ever count up. Now that the menu stays live — it did not
   * before, which is the bug this sits next to — a doctor who picked himself,
   * changed to somebody else and changed back would be charged twice for one
   * save, and his single self-save would be gone before the night resolved.
   * So moving away gives it back.
   */
  if (action.selfUses !== undefined) {
    const was = already?.target === i.user.id;
    const now = target === i.user.id;
    if (was !== now) {
      const have = st.selfUses?.[i.user.id] ?? 0;
      patch.selfUses = { ...(st.selfUses ?? {}), [i.user.id]: Math.max(0, have + (now ? 1 : -1)) };
    }
  }

  const picks = { ...(st.nightPicks ?? {}) };
  picks[i.user.id] = { role: me.role ?? '', target, at: Date.now(), variant: already?.variant };
  await mergeState(ev.id, { nightPicks: picks, ...patch });

  // Re-read, then build the menu from that. A card drawn from the state this
  // click assumed is the one that shows a choice the game did not record.
  const fresh = (await getEvent(ev.id)) ?? ev;
  const menu = nightRow(fresh, me, action, legalTargets(fresh, me, roster, action), target);

  // A gun is two decisions, not one.
  if (action.followUp) {
    await i.update({
      components: [new ContainerBuilder().setAccentColor(C.night)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## 🔫 ${action.followUp.label}\nHadaf: <@${target}>`))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(enc('variant', ev.id, '0')).setLabel(action.followUp.options[0])
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(enc('variant', ev.id, '1')).setLabel(action.followUp.options[1])
            .setStyle(ButtonStyle.Danger)))
        // Handing the gun over is two decisions, and either of them can be
        // taken back until morning — not just the second one.
        .addActionRowComponents(menu)],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
    return;
  }

  // The detective is answered on the spot. Everyone else's choice goes to the
  // narrator, who still decides what the night actually does.
  if (action.answersActor) {
    const t = roster.find(p => p.userId === target);

    // Saul learns the actual role; the detective learns only a side, and the
    // Godfather reads as a citizen to them — the point of the scenario.
    if (action.reveals === 'role') {
      const answer = `## 🕵️ Naghshe <@${target}>\n**${roleOf(t?.role ?? null).fa}**`;
      const seen = await i.update({
        components: [new ContainerBuilder().setAccentColor(C.mafia)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(answer))
          .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '-# Faghat to in ro didi. In tavanayi tamoom shod.'))],
        flags: MessageFlags.IsComponentsV2,
      }).then(() => true).catch(() => false);
      if (!seen) await deliverAnswer(i, ev, answer, C.mafia);
      return;
    }

    const shown = t?.role === 'godfather' ? 'town' : t?.side;
    const answer = `## 🔍 Natijeye estelam\n<@${target}> → **${shown === 'mafia' ? 'مافیا' : 'شهروند'}**`;
    const delivered = await i.update({
      components: [new ContainerBuilder().setAccentColor(shown === 'mafia' ? C.mafia : C.town)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(answer))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '-# Faghat to in ro didi. Ta sobh mitooni yeki dige ro estelam koni.'))
        // The menu is rebuilt rather than reused: they may change their mind
        // until the narrator calls morning, and the answer updates with it.
        // Shared with the prompt so the legal targets cannot drift apart.
        .addActionRowComponents(menu)],
      flags: MessageFlags.IsComponentsV2,
    }).then(() => true).catch(() => false);
    if (!delivered) await deliverAnswer(i, ev, answer, shown === 'mafia' ? C.mafia : C.town);
    return;
  }

  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.night)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ✅ Sabt shod\n${action.label} → <@${target}>`))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '-# Gardanande in ro mibine. Ta sobh mitooni avazesh koni.'))
      .addActionRowComponents(menu)],
    flags: MessageFlags.IsComponentsV2,
  }).catch(() => {});
}

/** The second half of a two-part night action, e.g. which gun was handed over. */
async function recordVariant(i: ButtonInteraction, ev: EventRow, which: string): Promise<void> {
  const roster = await players(ev.id);
  const me = roster.find(p => p.userId === i.user.id);
  const action = nightActionFor(me?.role ?? null);
  if (!me || !action?.followUp) return;

  const st = ev.state as DayState;
  const pick = st.nightPicks?.[i.user.id];
  if (!pick) return;

  const label = action.followUp.options[Number(which) === 1 ? 1 : 0]!;
  await mergeState(ev.id, {
    nightPicks: { ...st.nightPicks, [i.user.id]: { ...pick, variant: label } },
  });

  const fresh = (await getEvent(ev.id)) ?? ev;
  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.night)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ✅ Sabt shod\n${action.label} → <@${pick.target}> · **${label}**`))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '-# Gardanande in ro mibine. Ta sobh mitooni avazesh koni.'))
      // Both halves stay live until morning: the other gun, or another person
      // entirely. Saying it can be changed and then showing nothing to change
      // is how this went wrong in the first place.
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('variant', ev.id, '0')).setLabel(action.followUp.options[0])
          .setStyle(label === action.followUp.options[0] ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(enc('variant', ev.id, '1')).setLabel(action.followUp.options[1])
          .setStyle(label === action.followUp.options[1] ? ButtonStyle.Danger : ButtonStyle.Secondary)))
      .addActionRowComponents(
        nightRow(fresh, me, action, legalTargets(fresh, me, roster, action), pick.target))],
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
        new ButtonBuilder().setCustomId(enc('ejmaend', ev.id)).setLabel('Bastane ray giri avval')
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
        new ButtonBuilder().setCustomId(enc('closevote', ev.id)).setLabel('Bastane ejma')
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
