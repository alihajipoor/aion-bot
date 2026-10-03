import {
  SlashCommandBuilder, MessageFlags, PermissionFlagsBits, type GuildMember,
} from 'discord.js';
import { recentGames, setGameMvp, playerRecord, totalWins, totalLosses } from '../lib/mafiaStats.js';
import { refreshScoreboard } from '../modules/mafiaScoreboard.js';
import { refreshMafiaHistory } from '../modules/mafiaHistory.js';
import { isolate, num } from '../lib/text.js';
import { hasRole } from '../lib/roles.js';
import {
  openSeason, awardPoint, undoPoint, recentPoints, REASONS, reasonOf,
} from '../lib/mafiaSeason.js';
import { refreshSeasonBoard } from '../modules/mafiaSeasonBoard.js';
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
      .addUserOption(o => o.setName('user').setDescription('Ki? (khali = khodet)')))
    /*
     * Points, away from the console.
     *
     * The console button needs a game open, and the two commonest corrections
     * happen when there is not one: remembering afterwards that somebody
     * deserved a point, and deciding on reflection that somebody did not.
     * Same season, same rows, same board — just reachable at any hour.
     */
    .addSubcommand(s => s.setName('emtiaz')
      .setDescription('Be yeki emtiaz bede — baazi lazem nist')
      .addUserOption(o => o.setName('user').setDescription('Ki?').setRequired(true))
      .addStringOption(o => o.setName('dalil').setDescription('Baraye chi?').setRequired(true)
        .addChoices(...REASONS.map(r => ({ name: `${r.emoji} ${r.fa}`.slice(0, 100), value: r.key }))))
      .addStringOption(o => o.setName('tozih')
        .setDescription('Tozih — baraye "yek chiz e dige" lazem e')))
    .addSubcommand(s => s.setName('emtiaz-list')
      .setDescription('Akharin emtiaz haye dade shode, ba shomare')
      .addUserOption(o => o.setName('user').setDescription('Faghat ye nafar')))
    .addSubcommand(s => s.setName('emtiaz-hazf')
      .setDescription('Yek emtiaz ro pas begir')
      .addIntegerOption(o => o.setName('id')
        .setDescription('Shomare az emtiaz-list').setRequired(true))),

  async execute(i) {
    const sub = i.options.getSubcommand();
    const guild = i.guild!;
    const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? id;

    if (sub.startsWith('emtiaz')) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const m = i.member as GuildMember | null;
      if (!m || !isStaff(m)) { await i.editReply('Faghat gardanande va admin.'); return; }

      const season = await openSeason(guild.id);
      if (!season) { await i.editReply('Hich mosabeghe-i baz nist.'); return; }

      if (sub === 'emtiaz-list') {
        const only = i.options.getUser('user')?.id;
        const rows = (await recentPoints(guild.id, season.id, 25))
          .filter(r => !only || r.userId === only);
        if (!rows.length) { await i.editReply('Hanooz emtiazi dade nashode.'); return; }
        await i.editReply([
          `**${isolate(season.title)}** — akharin emtiaz ha:`,
          ...rows.slice(0, 15).map(r => {
            const d = reasonOf(r.reason);
            return `\`#${r.id}\` ${d.emoji} ${isolate(nameOf(r.userId))}`
              + ` — ${isolate(r.note ?? d.fa)}`
              + `  <t:${Math.floor(r.awardedAt.getTime() / 1000)}:R>`;
          }),
          '-# Ba `/mafia emtiaz-hazf id:<shomare>` pas migiri.',
        ].join('\n'));
        return;
      }

      if (sub === 'emtiaz-hazf') {
        const id = i.options.getInteger('id', true);
        // Scoped to this season on purpose: an id from a previous run is a
        // typo, not an instruction, and deleting by bare id would honour it.
        const mine = (await recentPoints(guild.id, season.id, 200)).find(r => r.id === id);
        if (!mine) { await i.editReply(`Emtiaz \`#${id}\` too in mosabeghe nist.`); return; }
        await undoPoint(id);
        await refreshSeasonBoard(guild).catch(() => {});
        await i.editReply(`🗑 Emtiaz \`#${id}\` az ${isolate(nameOf(mine.userId))} pas gerefte shod.`);
        return;
      }

      const who = i.options.getUser('user', true);
      const reason = i.options.getString('dalil', true);
      const note = i.options.getString('tozih')?.trim().slice(0, 160) ?? null;
      if (reason === 'other' && !note) {
        await i.editReply('Baraye "yek chiz e dige" bayad tozih benevisi.');
        return;
      }
      const row = await awardPoint({
        guildId: guild.id, seasonId: season.id, userId: who.id,
        reason, note, awardedBy: i.user.id,
      });
      await refreshSeasonBoard(guild).catch(() => {});
      const d = reasonOf(reason);
      await i.editReply(
        `⭐ ${num(1)} emtiaz be ${isolate(nameOf(who.id))} — ${d.emoji} ${isolate(note ?? d.fa)}`
        + `\n-# Shomare \`#${row.id}\` — age eshtebah bood, \`/mafia emtiaz-hazf id:${row.id}\`.`);
      return;
    }

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
    /*
     * And so is the card in the history channel.
     *
     * That post is the copy people actually read — the table is a summary
     * nobody opens afterwards. Naming an MVP used to update the database and
     * the scoreboard and leave the announcement itself saying nothing, which
     * looked exactly like the command had not worked.
     */
    const redrawn = await refreshMafiaHistory(guild, eventId).catch(() => false);
    await i.editReply(
      `⭐ MVP e bazi \`#${num(eventId)}\` shod **${isolate(nameOf(user.id))}**.`
      + (res.previous ? `\n-# Ghablan ${isolate(nameOf(res.previous))} bood — shomaresh oon pas gerefte shod.` : '')
      + '\n-# Jadval update shod.'
      + (redrawn
        ? '\n-# Kart e tarikhche ham edit shod.'
        : '\n-# ⚠️ Kart e tarikhche peyda nashod — oon post dasti bayad edit beshe.'));
  },
};
export default command;
