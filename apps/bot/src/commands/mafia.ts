import {
  SlashCommandBuilder, MessageFlags, PermissionFlagsBits, type GuildMember,
} from 'discord.js';
import { recentGames, setGameMvp, playerRecord, totalWins, totalLosses } from '../lib/mafiaStats.js';
import { refreshScoreboard } from '../modules/mafiaScoreboard.js';
import { isolate, num } from '../lib/text.js';
import { hasRole } from '../lib/roles.js';
import type { Command } from '../types.js';

/**
 * Naming the MVP after the fact.
 *
 * God picks the MVP by hand and the ordinary mistake is pressing the win button
 * first. The game row is unique on its event, so there is no pressing win
 * again — without this the record would keep an empty MVP forever, which is a
 * poor reason to lose the one thing in the game that is decided by a person
 * rather than by the rules.
 */

const isStaff = (m: GuildMember): boolean =>
  m.permissions.has(PermissionFlagsBits.ManageGuild) ||
  hasRole(m, ['Consultant', 'PowerAdmin', 'Dev']);

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('mafia')
    .setDescription('Karhaye bad az bazi')
    .addSubcommand(s => s.setName('mvp')
      .setDescription('MVP e yek bazi ro moshakhas kon (bad az bazi ham mishe)')
      .addUserOption(o => o.setName('user').setDescription('Ki?').setRequired(true))
      .addIntegerOption(o => o.setName('event')
        .setDescription('Shomare-ye event — khali bezari, akharin bazi')))
    .addSubcommand(s => s.setName('games')
      .setDescription('Akharin bazi haye sabt shode'))
    .addSubcommand(s => s.setName('amar')
      .setDescription('Amar e yek bazikon')
      .addUserOption(o => o.setName('user').setDescription('Ki? (khali = khodet)'))),

  async execute(i) {
    const sub = i.options.getSubcommand();
    const guild = i.guild!;
    const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? id;

    if (sub === 'amar') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const who = i.options.getUser('user')?.id ?? i.user.id;
      const r = await playerRecord(guild.id, who);
      if (!r.games) { await i.editReply('Hanooz bazi-i azash sabt nashode.'); return; }
      await i.editReply([
        `## 📊 ${isolate(nameOf(who))}`,
        `Bazi **${num(r.games)}** · Bord **${num(totalWins(r))}** · Bakht **${num(totalLosses(r))}**`
          + (r.mvpCount ? ` · ⭐ **${num(r.mvpCount)}**` : ''),
        `🔴 Mafia: ${num(r.winsMafia)}/${num(r.winsMafia + r.lossesMafia)}`
          + `   🟢 Shahr: ${num(r.winsShahr)}/${num(r.winsShahr + r.lossesShahr)}`,
      ].join('\n'));
      return;
    }

    // Everything below writes, or exposes the roster of finished games.
    if (!isStaff(i.member as GuildMember)) {
      await i.reply({ content: 'Faghat gardanande-ha.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'games') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const rows = await recentGames(guild.id, 10);
      await i.editReply(rows.length
        ? ['## 🕐 Akharin bazi ha', '',
           ...rows.map(g => {
             const when = g.endedAt ? `<t:${Math.floor(g.endedAt.getTime() / 1000)}:R>` : '';
             return `\`#${num(g.eventId)}\`  ${g.winner === 'mafia' ? '🔴 mafia' : '🟢 shahr'}`
               + `  ·  ${num(g.playerCount)} nafar  ·  ${when}`
               + (g.mvpUserId ? `  ·  ⭐ ${isolate(nameOf(g.mvpUserId))}` : '  ·  ⭐ —');
           })].join('\n')
        : 'Hanooz bazi-i sabt nashode.');
      return;
    }

    // mvp
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const user = i.options.getUser('user')!;
    let eventId = i.options.getInteger('event');
    if (eventId === null) {
      // No event given: the last game is what "we forgot" almost always means.
      const [last] = await recentGames(guild.id, 1);
      if (!last) { await i.editReply('Hanooz bazi-i sabt nashode.'); return; }
      eventId = last.eventId;
    }

    const res = await setGameMvp(guild.id, eventId, user.id);
    if (!res.changed) {
      await i.editReply(res.previous === user.id
        ? `⭐ Hamin alanam MVP e bazi \`#${num(eventId)}\` hamin nafar-e.`
        : `Bazi-i ba shomare \`#${num(eventId)}\` peyda nashod. Ba \`/mafia games\` check kon.`);
      return;
    }

    // The scoreboard counts MVPs, so it is stale the moment this changes.
    await refreshScoreboard(guild).catch(() => {});
    await i.editReply(
      `⭐ MVP e bazi \`#${num(eventId)}\` shod **${isolate(nameOf(user.id))}**.`
      + (res.previous ? `\n-# Ghablan ${isolate(nameOf(res.previous))} bood — shomaresh oon pas gerefte shod.` : '')
      + '\n-# Jadval update shod.');
  },
};
export default command;
