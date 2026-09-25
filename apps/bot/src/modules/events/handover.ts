import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  PermissionFlagsBits,
  type ButtonInteraction, type StringSelectMenuInteraction,
  type Guild, type GuildMember, type TextChannel,
} from 'discord.js';
import { isolate, num, asciiFold } from '../../lib/text.js';
import {
  getEvent, patchEvent, mergeState, players, assignRole, removePlayer,
  type EventRow, type PlayerRow,
} from './store.js';
import { resealEventAccess } from './lockout.js';
import { logger } from '../../lib/log.js';

const log = logger('handover');

/**
 * Redraws the cards that name the narrator.
 *
 * The control card and the signup post both print "Gardanande", and both live
 * in events/index.ts — which imports this module's callers, so importing it
 * back would close a cycle. It hands its refresher in at install time, the
 * same trick `setEventFinisher` plays.
 */
type CardRefresher = (guild: Guild, ev: EventRow) => Promise<void>;
let refreshCards: CardRefresher | null = null;
export const setCardRefresher = (fn: CardRefresher): void => { refreshCards = fn; };

/**
 * Redraw both cards for an event, from anywhere that changed what they say.
 *
 * The settings panel needs this too: the signup post prints the cast, so a
 * host who edits the role counts and never sees the post change assumes the
 * edit did nothing. It lives here because this is already the module holding
 * the injected refresher, and importing it is cycle-free — handover imports
 * nothing that imports the panel.
 */
export const refreshEventCards = async (guild: Guild, ev: EventRow): Promise<void> => {
  await refreshCards?.(guild, ev);
};

/**
 * Two repairs a narrator needs mid-evening, shared by both consoles.
 *
 *   · hand the game to somebody else without disturbing anything else
 *   · exchange two players' roles, because one of them cannot play theirs
 *
 * Neither is scenario-specific, so neither lives in a scenario's file.
 */

const eph = { flags: MessageFlags.Ephemeral } as const;
const v2eph = { flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };

const card = (title: string, body?: string, colour = 0x9b6cff) =>
  new ContainerBuilder().setAccentColor(colour)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      body ? `${title}\n${body}` : title));

/** The game's own room and the hall — the only places a candidate can be. */
export function nearby(guild: Guild | null, ev: EventRow): GuildMember[] {
  if (!guild) return [];
  const out = new Map<string, GuildMember>();
  const rooms = [
    ev.voiceChannelId ? guild.channels.cache.get(ev.voiceChannelId) : undefined,
    [...guild.channels.cache.values()].find(c =>
      c.isVoiceBased() && /event[-\s]?hall/i.test(asciiFold(c.name))),
  ];
  for (const room of rooms) {
    if (!room?.isVoiceBased()) continue;
    for (const m of room.members.values()) if (!m.user.bot) out.set(m.id, m);
  }
  return [...out.values()];
}

/* ══ handing the game over ═════════════════════════════════════════ */

export const godButton = (prefix: string, eventId: number): ButtonBuilder =>
  new ButtonBuilder().setCustomId(`${prefix}|god|${eventId}`).setLabel('Gardanande')
    .setEmoji('🎙').setStyle(ButtonStyle.Secondary);

/**
 * Offers the people who could take over.
 *
 * Once the cards are out, a living player is not on the list: whoever narrates
 * reads every role, so handing it to somebody still playing does not transfer
 * the job, it ends the game — quietly, with nobody saying so. The dead are
 * fine; they are out and already know what they knew.
 *
 * Before the game starts, that rule has nothing to protect and everything to
 * break. Signed-up players are all "alive" from the moment they press Sabt-nam,
 * so applying it to a game that has not been dealt ruled out the entire room
 * and left the host staring at "nobody can take this". There are no roles yet.
 * Anyone in earshot can take it, and if they had signed up they simply stop
 * being a player — a narrator does not hold a card.
 */
export async function godPrompt(
  i: ButtonInteraction, ev: EventRow, prefix: string,
): Promise<void> {
  const roster = await players(ev.id);
  const dealt = ev.status === 'running' && roster.some(p => p.role);
  const barred = dealt
    ? new Set(roster.filter(p => p.alive).map(p => p.userId))
    : new Set<string>();
  const here = nearby(i.guild, ev)
    .filter(m => m.id !== ev.hostId && !barred.has(m.id));

  if (!here.length) {
    await i.reply({
      content: dealt
        ? 'Kesi nist ke betoone gardanande beshe — bazikon-haye zende nemitoonan.'
          + '\n-# Har ki mikhad, aval biad too voice.'
        : 'Kesi too voice nist. Har ki mikhad gardanande beshe, aval biad too voice.',
      ...eph,
    });
    return;
  }

  await i.reply({
    components: [card('## 🎙 Avaz kardane gardanande',
      `Alan: <@${ev.hostId}>\n-# Tanzimat, naghsh-ha va marhale-ye baazi dast nemikhore.`)
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${prefix}|godpick|${ev.id}`)
          .setPlaceholder(`Ki gardanande beshe? (${num(here.length)} nafar)`)
          .addOptions(here.slice(0, 25).map(m => new StringSelectMenuOptionBuilder()
            .setLabel(m.displayName.slice(0, 60))
            .setDescription(!roster.some(p => p.userId === m.id) ? 'tamashachi'
              : dealt ? 'az baazi hazf shode' : 'sabt-nam karde — az liste baazi dar miad')
            .setValue(m.id)))))],
    ...v2eph,
  });
}

/**
 * Moves the job, and only the job.
 *
 * Almost everything reads `ev.hostId` live — the console gate, the lockout, the
 * night report, every card — so the column is nearly the whole change. The two
 * things that do not follow on their own are handled here: the mafia room's
 * overwrite, which was written once with the old host's id, and the lockout,
 * which has to be re-derived so the new narrator is unlocked and given sight of
 * the console while the old one loses the grant.
 *
 * Nothing about the game itself is touched. No setting, no role, no phase.
 */
export async function godSwap(
  i: StringSelectMenuInteraction, ev: EventRow, incoming: string,
  ctx: { chat: TextChannel | undefined },
): Promise<void> {
  if (!i.deferred && !i.replied) await i.deferUpdate();
  const guild = i.guild!;

  const roster = await players(ev.id);
  const dealt = ev.status === 'running' && roster.some(p => p.role);

  if (dealt && roster.some(p => p.userId === incoming && p.alive)) {
    await i.editReply({
      components: [card('## ⚠️ Bazikon-e zende nemitoone gardanande beshe',
        'Gardanande hameye naghsh-ha ro mibine. Aval az baazi darash biar.', 0xed4245)],
      ...v2eph,
    });
    return;
  }

  /*
   * Before the deal, a signed-up player may take it — and stops being a player.
   *
   * A narrator does not hold a card. Leaving them on the roster would deal them
   * one and then lock them out of the console they are supposed to be running,
   * because the lockout shuts out everybody on the roster except the host — and
   * they would be both.
   */
  const wasPlaying = !dealt && roster.some(p => p.userId === incoming);
  if (wasPlaying) await removePlayer(ev.id, incoming);

  const member = await guild.members.fetch(incoming).catch(() => null);
  if (!member) {
    await i.editReply({ components: [card('## ⚠️ Oon user peyda nashod.', undefined, 0xed4245)], ...v2eph });
    return;
  }

  const outgoing = ev.hostId;
  await patchEvent(ev.id, { hostId: incoming, hostTag: member.user.tag });

  /*
   * The mafia room is cut per id, so it does not follow the column.
   *
   * The outgoing narrator only loses the room if they are not on the mafia
   * team themselves — which they are not, since narrators do not play, but a
   * game that started with a different host would have left their grant
   * behind. Removing it is safe either way and leaving it is not.
   */
  const room = [...guild.channels.cache.values()].find(c =>
    c.isTextBased() && new RegExp(`(?:scum|mafia)-${ev.id}$`).test(c.name ?? ''));
  if (room && 'permissionOverwrites' in room) {
    const onTeam = roster.some(p => p.userId === outgoing && p.side === 'mafia');
    if (!onTeam) {
      await room.permissionOverwrites.delete(outgoing, 'AION: no longer narrating').catch(() => {});
    }
    await room.permissionOverwrites.edit(incoming, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
    }, { reason: 'AION: narrating' }).catch(() => {});
  }

  const fresh = (await getEvent(ev.id))!;
  // Re-derived in both directions: the new narrator is unlocked and given sight
  // of the console, the old one's grant comes off.
  await resealEventAccess(guild, fresh, `AION event #${ev.id} — new narrator`);
  await refreshCards?.(guild, fresh).catch(() => {});

  await ctx.chat?.send({
    components: [card('## 🎙 Gardanande avaz shod',
      `<@${outgoing}> → <@${incoming}>`
      + (wasPlaying ? '\n-# Az liste sabt-nam dar oomad — gardanande baazi nemikone.' : '')
      + '\n-# Baazi hamoon jaii-ye ke bood. Hich chiz reset nashod.')],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [outgoing, incoming] },
  }).catch(() => {});

  log.info(`event #${ev.id}: narrator ${outgoing} -> ${incoming}`);
  await i.editReply({
    components: [card('## ✅ Gardanande avaz shod',
      `Hala <@${incoming}> gardanande-st.\n-# Console ro oon baz kone. Tanzimat dast nakhorde.`)],
    ...v2eph,
  });
}

/* ══ exchanging two roles ══════════════════════════════════════════ */

export const swapRoleButton = (prefix: string, eventId: number, enough: boolean): ButtonBuilder =>
  new ButtonBuilder().setCustomId(`${prefix}|rswap|${eventId}`).setLabel('Taviz-e naghsh')
    .setEmoji('🔀').setStyle(ButtonStyle.Secondary).setDisabled(!enough);

const seatLine = (p: PlayerRow, faOf: (k: string | null) => string, nameOf: (id: string) => string) =>
  `${p.seat ?? '?'} · ${(p.userTag ?? nameOf(p.userId)).slice(0, 40)}`;

/** Step one: whose role is being given away. */
export async function swapRolePrompt(
  i: ButtonInteraction, ev: EventRow, prefix: string,
  faOf: (k: string | null) => string, nameOf: (id: string) => string,
): Promise<void> {
  const roster = (await players(ev.id)).filter(p => p.alive && p.role);
  if (roster.length < 2) {
    await i.reply({ content: 'Baraye taviz hadeaghal do bazikon-e zende lazem-e.', ...eph });
    return;
  }
  await i.reply({
    components: [card('## 🔀 Taviz-e naghsh',
      'Do nafar naghsh-eshoon ba ham avaz mishe. Sandali va zende budan dast nemikhore.')
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${prefix}|rswapa|${ev.id}`)
          .setPlaceholder('Nafar-e aval')
          .addOptions(roster.slice(0, 25).map(p => new StringSelectMenuOptionBuilder()
            .setLabel(seatLine(p, faOf, nameOf))
            .setDescription(faOf(p.role).slice(0, 90))
            .setValue(p.userId)))))],
    ...v2eph,
  });
}

/** Step two: who they are exchanging with. */
export async function swapRolePickB(
  i: StringSelectMenuInteraction, ev: EventRow, prefix: string, a: string,
  faOf: (k: string | null) => string, nameOf: (id: string) => string,
): Promise<void> {
  const roster = (await players(ev.id)).filter(p => p.alive && p.role && p.userId !== a);
  await i.update({
    components: [card('## 🔀 Taviz-e naghsh',
      `Nafar-e aval: **${isolate(nameOf(a))}**\nBa ki avaz beshe?`)
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${prefix}|rswapb|${ev.id}|${a}`)
          .setPlaceholder('Nafar-e dovom')
          .addOptions(roster.slice(0, 25).map(p => new StringSelectMenuOptionBuilder()
            .setLabel(seatLine(p, faOf, nameOf))
            .setDescription(faOf(p.role).slice(0, 90))
            .setValue(p.userId)))))],
    ...v2eph,
  });
}

/**
 * Exchanges two players' roles, and everything that hangs off a role.
 *
 * The pieces move in different directions, which is the whole difficulty:
 *
 *   role and side      swap — that is the request
 *   seat               stays — a seat is where you sit, not what you hold
 *   alive              stays — swapping roles is not a resurrection
 *   counters (`uses`)  swap, with the role. A sniper who has already fired one
 *                      of two hands over a magazine with one left, not a fresh
 *                      one; and the man giving up the sniper does not keep
 *                      bullets for a role he no longer has.
 *   a gun in hand      stays — the Kalantar handed a physical thing to a
 *                      person, and that person still has it.
 *   tonight's pick     dropped for both. It was made as a different role, and
 *                      acting twice in one night is the bug that would follow.
 *   mafia room         re-cut, because the team just changed.
 *
 * Both are told what they now hold. Nobody else is told anything: the exchange
 * is announced as having happened, without names, or the table learns two
 * roles for the price of one.
 */
export async function swapRoleDo(
  i: StringSelectMenuInteraction, ev: EventRow, a: string, b: string,
  ctx: {
    chat: TextChannel | undefined;
    faOf: (k: string | null) => string;
    nameOf: (id: string) => string;
    blurbOf: (k: string | null) => string;
  },
): Promise<void> {
  if (!i.deferred && !i.replied) await i.deferUpdate();
  const guild = i.guild!;

  const roster = await players(ev.id);
  const pa = roster.find(p => p.userId === a);
  const pb = roster.find(p => p.userId === b);
  if (!pa?.role || !pb?.role || a === b) {
    await i.editReply({
      components: [card('## ⚠️ Nashod', 'Yeki az oon do nafar naghsh nadare.', 0xed4245)],
      ...v2eph,
    });
    return;
  }

  // Seats stay with the people; only the cards change hands.
  await assignRole(ev.id, a, pb.role, pb.side ?? '', pa.seat ?? 0);
  await assignRole(ev.id, b, pa.role, pa.side ?? '', pb.seat ?? 0);

  const st = ev.state as {
    uses?: Record<string, number>;
    nightPicks?: Record<string, unknown>;
  };
  const uses = { ...(st.uses ?? {}) };
  const ua = uses[a];
  const ub = uses[b];
  // Delete first: a role with no counter must not inherit the other's.
  delete uses[a]; delete uses[b];
  if (ub !== undefined) uses[a] = ub;
  if (ua !== undefined) uses[b] = ua;

  const picks = { ...(st.nightPicks ?? {}) };
  delete picks[a]; delete picks[b];

  await mergeState(ev.id, { uses, nightPicks: picks });

  // The team changed, so the room's door has to change with it.
  const room = [...guild.channels.cache.values()].find(c =>
    c.isTextBased() && new RegExp(`(?:scum|mafia)-${ev.id}$`).test(c.name ?? ''));
  if (room && 'permissionOverwrites' in room) {
    for (const [who, nowSide] of [[a, pb.side], [b, pa.side]] as const) {
      if (nowSide === 'mafia') {
        await room.permissionOverwrites.edit(who, {
          ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
        }, { reason: 'AION: role exchange' }).catch(() => {});
      } else {
        await room.permissionOverwrites.delete(who, 'AION: role exchange').catch(() => {});
      }
    }
  }

  const tell = async (who: string, role: string | null, side: string | null) => {
    const m = await guild.members.fetch(who).catch(() => null);
    if (!m) return false;
    return m.send({
      components: [card(
        `## ${side === 'mafia' ? '🔴' : side === 'gray' ? '⚪' : '🟢'} ${isolate(ctx.faOf(role))}`,
        `Naghshet avaz shod.\n${ctx.blurbOf(role)}`
        + (side === 'mafia' && room ? `\n-# Otagh-e mafia: <#${room.id}>` : '\n-# Be hich kas nagoo.'),
        side === 'mafia' ? 0xed4245 : 0x57f287)],
      flags: MessageFlags.IsComponentsV2,
    }).then(() => true).catch(() => false);
  };
  const toldA = await tell(a, pb.role, pb.side);
  const toldB = await tell(b, pa.role, pa.side);

  const fresh = (await getEvent(ev.id))!;
  await refreshCards?.(guild, fresh).catch(() => {});

  /*
   * The table is told it happened, and nothing else.
   *
   * Naming the two would hand everybody a pair of roles to reason about, and
   * saying nothing at all lets a narrator be accused of fixing the game later.
   * That it happened is public; who and what is not.
   */
  await ctx.chat?.send({
    components: [card('## 🔀 Do naghsh ba ham avaz shod',
      '-# Ki ba ki, va che naghshi — gofte nemishe.')],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch(() => {});

  log.info(`event #${ev.id}: roles exchanged between ${a} and ${b}`);
  await i.editReply({
    components: [card('## ✅ Taviz anjam shod',
      `**${isolate(ctx.nameOf(a))}** → ${isolate(ctx.faOf(pb.role))}\n`
      + `**${isolate(ctx.nameOf(b))}** → ${isolate(ctx.faOf(pa.role))}\n`
      + '-# Sandali, zende budan va shomarande-ha jabeja shodan.'
      + (toldA && toldB ? '' : '\n⚠️ DM-e yeki azashoon baste-st — dasti behesh begoo.'))],
    ...v2eph,
  });
}
