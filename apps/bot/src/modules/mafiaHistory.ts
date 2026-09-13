import {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MessageFlags, ChannelType, type Guild, type TextChannel,
} from 'discord.js';
import {
  recordGame, normalizeSide,
  type FinishedGame, type FinishedPlayer, type MafiaSide,
} from '../lib/mafiaStats.js';
import { findRole } from '../lib/roles.js';
import { asciiFold, isolate, num } from '../lib/text.js';
import { logger } from '../lib/log.js';

const log = logger('mafia-history');

/**
 * The history channel: one card per finished game.
 *
 * Events delete their own channels when they end, so without this the only
 * trace a game leaves is in the memory of the people who played it. The card is
 * the receipt — who won, who was who, and who God gave the MVP to.
 *
 * The roster is the part that has to be here. Roles are never revealed during
 * the game (only Kalantar's gun does that), so the reveal is the reason anyone
 * reads the channel at all.
 */

/** Mafia red. The night colour would be unreadable as an accent bar. */
export const MAFIA_ACCENT = 0xed4245;
export const SHAHR_ACCENT = 0x57f287;

/** The signup marker, and the only thing this module is ever allowed to ping. */
export const MAFIA_PLAYER_ROLE = 'ᴍᴀꜰɪᴀ│𝙿𝙻𝙰𝚈𝙴𝚁│•';

/**
 * Found by folded name, never by raw string.
 *
 * Channel names are written in the server's font — 𝙼𝙰𝙵𝙸𝙰-𝙷𝙸𝚂𝚃𝙾𝚁𝚈 with bullets
 * and separators around it — and Discord lowercases them on top. Comparing the
 * decorated name directly is how a restyle turns "post the card" into "no
 * channel found" with nothing in the log to explain it.
 */
export const mafiaHistoryChannel = (g: Guild): TextChannel | null =>
  ([...g.channels.cache.values()].find(c =>
    c.type === ChannelType.GuildText &&
    /mafia-?history/.test(asciiFold(c.name))) as TextChannel) ?? null;

export const mafiaGuideChannel = (g: Guild): TextChannel | null =>
  ([...g.channels.cache.values()].find(c =>
    c.type === ChannelType.GuildText &&
    /mafia-?guide/.test(asciiFold(c.name))) as TextChannel) ?? null;

/* ── rendering ─────────────────────────────────────────────────── */

const SIDE_FA: Record<MafiaSide, string> = { mafia: 'مافیا', shahr: 'شهر' };
const SIDE_DOT: Record<MafiaSide, string> = { mafia: '🔴', shahr: '🟢' };

const MODE_FA: Record<string, string> = {
  persian: 'مافیای ایرانی',
  scum: 'مافیا اسکام',
};

/**
 * One roster line.
 *
 * Every name is isolated and every figure carries an Arabic Letter Mark. The
 * surrounding text is Persian and the names are Latin, so without it the bidi
 * algorithm walks the seat number over to the wrong player — which is exactly
 * how the giveaway board shipped broken twice.
 */
function rosterLine(p: FinishedPlayer, nameOf: (id: string) => string, mvpId?: string | null): string {
  const side = normalizeSide(p.side);
  const dot = side ? SIDE_DOT[side] : '⚪';
  const role = p.roleFa ?? (p.role ? isolate(p.role) : null);
  const sideFa = side ? SIDE_FA[side] : 'مستقل';
  return `${dot} ${isolate(nameOf(p.userId))}` +
    (role ? ` — **${role}**` : '') +
    ` · ${sideFa}` +
    (mvpId && p.userId === mvpId ? ' 🏅' : '');
}

/**
 * The card itself.
 *
 * Split out from the posting so the same rendering can be reused for a
 * backfill or a `/mafia history` reply without a second copy drifting away
 * from this one.
 */
export function historyCard(game: FinishedGame, nameOf: (id: string) => string): ContainerBuilder {
  const won = game.winner;
  const c = new ContainerBuilder()
    .setAccentColor(won === 'mafia' ? MAFIA_ACCENT : SHAHR_ACCENT);

  const mode = MODE_FA[game.mode ?? 'persian'] ?? isolate(game.mode ?? 'persian');
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `# ${SIDE_DOT[won]} ${SIDE_FA[won]} برد\n-# ${mode} · ${num(game.players.length)} بازیکن`));
  c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  // Winners first, then the losing side, then the gray roles that belong to
  // neither. Reading the winning team as a block is the first thing anyone
  // opening this channel wants.
  const rank = (p: FinishedPlayer) => {
    const s = normalizeSide(p.side);
    return s === won ? 0 : s === null ? 2 : 1;
  };
  const roster = [...game.players].sort((a, b) => rank(a) - rank(b));

  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    roster.length
      ? roster.map(p => rosterLine(p, nameOf, game.mvpUserId)).join('\n')
      : '_هیچ بازیکنی ثبت نشده._'));

  if (game.mvpUserId) {
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `🏅 **بهترین بازیکن:** <@${game.mvpUserId}>`));
  }

  c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const when = Math.floor((game.endedAt ?? new Date()).getTime() / 1000);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# بازی #${num(game.eventId)} · <t:${when}:f>`));
  return c;
}

/* ── posting ───────────────────────────────────────────────────── */

export interface PostResult {
  /** False when this event was already written down — the card is not reposted. */
  recorded: boolean;
  messageId: string | null;
}

/**
 * Record a finished game and post its card. **This is the call site's entry
 * point** — the game-end path should call exactly this, once.
 *
 *   await postMafiaHistory(guild, {
 *     guildId: guild.id,
 *     eventId: ev.id,
 *     mode: 'persian',                 // optional, defaults to 'persian'
 *     winner: 'mafia',                 // 'mafia' | 'shahr'
 *     mvpUserId: someUserId ?? null,   // optional, God picks it by hand
 *     endedAt: new Date(),             // optional, defaults to now
 *     players: roster.map(p => ({
 *       userId: p.userId,
 *       role: p.role,                  // the role key, e.g. 'detective'
 *       roleFa: roleOf(p.role).fa,     // optional Persian label for the card
 *       side: p.side,                  // 'mafia' | 'town' | 'shahr' | 'solo'
 *     })),
 *   });
 *
 * Safe to call twice. Recording is idempotent on `eventId`, and a second call
 * neither moves anybody's totals nor posts a duplicate card — it returns
 * `{ recorded: false, messageId: null }`.
 *
 * Never throws at the call site's expense: a missing channel or a failed send
 * is logged and swallowed, because a game must not be left half-ended because
 * someone deleted a channel.
 */
export async function postMafiaHistory(guild: Guild, game: FinishedGame): Promise<PostResult> {
  let row;
  try {
    row = await recordGame(game);
  } catch (e) {
    log.error(`could not record game for event ${game.eventId}`, e);
    return { recorded: false, messageId: null };
  }
  if (!row) {
    log.info(`event ${game.eventId} was already recorded — not reposting`);
    return { recorded: false, messageId: null };
  }

  const channel = mafiaHistoryChannel(guild);
  if (!channel) {
    log.warn('no mafia history channel found — the game is recorded but unannounced');
    return { recorded: true, messageId: null };
  }

  const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? id;

  // The ping lives in the text, because a Components V2 message carries no
  // separate content field. allowedMentions is what decides whether it rings,
  // and it names the one role by id — `parse` is left empty so that an
  // @everyone written into a role name, a nickname or a role label can never
  // become an actual @everyone. This channel must never ring the whole server.
  const role = findRole(guild, MAFIA_PLAYER_ROLE);
  const components = role
    ? [new ContainerBuilder()
        .setAccentColor(game.winner === 'mafia' ? MAFIA_ACCENT : SHAHR_ACCENT)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${role.id}>`)),
      historyCard(game, nameOf)]
    : [historyCard(game, nameOf)];

  if (!role) log.warn(`${MAFIA_PLAYER_ROLE} not found — posting without a ping`);

  try {
    const msg = await channel.send({
      components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [], roles: role ? [role.id] : [] },
    });
    log.info(`game ${game.eventId} posted to #${channel.name}`);
    return { recorded: true, messageId: msg.id };
  } catch (e) {
    log.error('could not post the history card', e);
    return { recorded: true, messageId: null };
  }
}
