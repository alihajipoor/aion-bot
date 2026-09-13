import {
  SlashCommandBuilder, MessageFlags, AttachmentBuilder, PermissionFlagsBits,
  type GuildMember, type ButtonInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { getDb, giveaways } from '@aion/db';
import {
  GW, openGiveaway, boardContainer, breakdown, buttons, personalInvite, scoreInvites, stamp,
  unattributedJoins,
} from '../lib/giveaway.js';
import { REASON_TEXT, type Reason } from '../lib/invites.js';
import { renderLeaderboardBanner } from '../lib/banner.js';
import { hasRole } from '../lib/roles.js';
import type { Command } from '../types.js';

/**
 * Dev and above only — the giveaway hands out real money, so starting, closing
 * and inspecting it is not a moderation power. The guild owner is included so
 * the server cannot lock itself out of its own competition.
 *
 * board and man stay open to everyone; they are the whole point.
 */
const ADMIN_ONLY = ['start', 'close', 'cancel', 'review', 'check'];
const isAdmin = (m: GuildMember) => hasRole(m, ['Dev']) || m.id === m.guild.ownerId;

/** Shared by the command and the board button. */
export async function boardReply(guild: import('discord.js').Guild) {
  const g = await openGiveaway(guild.id);
  if (!g) return null;
  const scores = await scoreInvites(guild.id, {
    from: g.startsAt, to: new Date(), minAccountAgeDays: g.minAccountAgeDays,
  });
  const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? `<@${id}>`;
  const png = await renderLeaderboardBanner({
    title: 'Musabeghe-ye Davat', subtitle: `${guild.name} · ${g.title}`,
    accent: '#9b6cff', kicker: 'DAVAT',
    rows: scores.slice(0, 8).filter(s => s.qualified > 0).map(s => ({
      name: nameOf(s.inviterId), value: `${s.qualified} nafar`, amount: s.qualified,
    })),
  }).catch(() => null);
  return {
    components: [boardContainer(g, scores, nameOf, png ? 'giveaway.png' : undefined)],
    ...(png ? { files: [new AttachmentBuilder(png, { name: 'giveaway.png' })] } : {}),
    flags: MessageFlags.IsComponentsV2 as const,
  };
}

/* ── the three buttons under the announcement ──────────────────── */

export async function handleButton(i: ButtonInteraction): Promise<void> {
  const action = i.customId.split('|')[1];
  const guild = i.guild!;

  if (action === 'link') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const url = await personalInvite(guild, i.user.id);
    await i.editReply(url
      ? ['## 🔗 لینک دعوت تو', url, '',
         'این لینک مال خودته و همیشه ثابت می‌مونه — هر کی باهاش بیاد، به اسم تو ثبت می‌شه.',
         'همینو برای دوستات بفرست.'].join('\n')
      : 'نشد لینک بسازم. به ادمین بگو.');
    return;
  }

  if (action === 'me') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const g = await openGiveaway(guild.id);
    if (!g) { await i.editReply('الان مسابقه‌ای در جریان نیست.'); return; }
    const scores = await scoreInvites(guild.id, {
      from: g.startsAt, to: new Date(), minAccountAgeDays: g.minAccountAgeDays,
    });
    await i.editReply(breakdown(guild, scores, i.user.id));
    return;
  }

  if (action === 'board') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const reply = await boardReply(guild);
    if (!reply) { await i.editReply('الان مسابقه‌ای در جریان نیست.'); return; }
    await i.editReply(reply);
  }
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Musabeghe-ye davat')
    .addSubcommand(s => s.setName('board').setDescription('Jadval-e musabeghe'))
    .addSubcommand(s => s.setName('man').setDescription('Davat-haye khodet ba jozeiat'))
    .addSubcommand(s => s.setName('check').setDescription('Davat-haye yek nafar (admin)')
      .addUserOption(o => o.setName('user').setDescription('Ki?').setRequired(true)))
    .addSubcommand(s => s.setName('review').setDescription('Davat-haye mashkook (admin)'))
    .addSubcommand(s => s.setName('start').setDescription('Shoru-e musabeghe (admin)')
      .addStringOption(o => o.setName('title').setDescription('Esm-e musabeghe').setRequired(true))
      .addIntegerOption(o => o.setName('days').setDescription('Chand rooz? (pishfarz 21)')
        .setMinValue(1).setMaxValue(120))
      .addIntegerOption(o => o.setName('first').setDescription('Hadeaghal baraye nafar avval (pishfarz 10)'))
      .addIntegerOption(o => o.setName('second').setDescription('Hadeaghal baraye nafar dovvom (pishfarz 7)'))
      .addIntegerOption(o => o.setName('third').setDescription('Hadeaghal baraye nafar sevvom (pishfarz 5)'))
      .addIntegerOption(o => o.setName('minage').setDescription('Sen-e account be rooz (pishfarz 30)')))
    .addSubcommand(s => s.setName('close').setDescription('Bastan va sabt-e natije (admin)'))
    .addSubcommand(s => s.setName('cancel').setDescription('Laghv-e musabeghe (admin)')),

  async execute(i) {
    const sub = i.options.getSubcommand();
    const member = i.member as GuildMember;
    const guildId = i.guildId!;

    if (ADMIN_ONLY.includes(sub) && !isAdmin(member)) {
      await i.reply({ content: 'In dastoor faghat baraye Dev-e.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'start') {
      if (await openGiveaway(guildId)) {
        await i.reply({ content: 'Yek musabeghe alan bazast. Aval `/giveaway close` ya `cancel`.',
          flags: MessageFlags.Ephemeral });
        return;
      }
      const days = i.options.getInteger('days') ?? 21;      // three weeks
      const floors = [
        i.options.getInteger('first') ?? 10,
        i.options.getInteger('second') ?? 7,
        i.options.getInteger('third') ?? 5,
      ];
      const endsAt = new Date(Date.now() + days * 86_400_000);
      await getDb().insert(giveaways).values({
        guildId, title: i.options.getString('title')!, floors, endsAt,
        minAccountAgeDays: i.options.getInteger('minage') ?? 30,
      });
      await i.reply({ content:
        `Shoru shod ✅ ta ${stamp(endsAt)} · hadeaghal ${floors.join(' / ')} nafar baraye 1/2/3.\n` +
        'Elan ta chand daghighe khodkar post mishe va har 24 saat tekrar mishe.',
        flags: MessageFlags.Ephemeral });
      return;
    }

    const g = await openGiveaway(guildId);

    if (sub === 'cancel') {
      if (!g) { await i.reply({ content: 'Musabeghe-i baz nist.', flags: MessageFlags.Ephemeral }); return; }
      await getDb().delete(giveaways).where(eq(giveaways.id, g.id));
      await i.reply({ content: 'Laghv shod.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (!g) {
      await i.reply({ content: 'Alan musabeghe-i dar jaryan nist.', flags: MessageFlags.Ephemeral });
      return;
    }

    const ephemeral = sub === 'man' || sub === 'check' || sub === 'review';
    await i.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});

    const scores = await scoreInvites(guildId, {
      from: g.startsAt, to: g.closedAt ?? new Date(), minAccountAgeDays: g.minAccountAgeDays,
    });

    if (sub === 'man' || sub === 'check') {
      const who = sub === 'check' ? i.options.getUser('user')!.id : i.user.id;
      await i.editReply(breakdown(i.guild!, scores, who));
      return;
    }

    if (sub === 'review') {
      const all = scores.flatMap(s => s.invitees.map(v => ({ ...v, inviterId: s.inviterId })));
      const guessed = all.filter(v => v.guessed);
      const unknown = await unattributedJoins(guildId, g.startsAt);
      const tally = all.reduce<Record<string, number>>((a, v) => {
        a[v.reason] = (a[v.reason] ?? 0) + 1; return a;
      }, {});

      // The health of the ledger, not just the suspicious rows — this is the
      // number to look at before trusting the board with a prize on it.
      const health = [
        '## 🔍 Salamat-e shomaresh',
        `Davat-haye sabt shode: **${all.length}**`,
        ...Object.entries(tally).map(([k, n]) => `> ${k === 'ok' ? '✅' : '❌'} ${REASON_TEXT[k as Reason]}: ${n}`),
        `Join-haye bedoon-e davat-konande: **${unknown}**` +
          (unknown ? ' — az link-e vanity ya vaghti bot khamoosh bood' : ''),
        `Hadsi (bot motmaen nabood): **${guessed.length}**`,
      ];

      await i.editReply([...health, '',
        ...(guessed.length
          ? ['**Mored-haye hadsi** — ghabl az jayeze yek negah behesh bendaz:', '',
             ...guessed.slice(0, 30).map(v => `• <@${v.userId}> → <@${v.inviterId}>` +
               (v.reason === 'ok' ? '' : ` _(${REASON_TEXT[v.reason]})_`))]
          : ['Hich mored-e hadsi nist — hame ghat\'i sabt shodan ✅'])].join('\n').slice(0, 3900));
      return;
    }

    if (sub === 'close') {
      await getDb().update(giveaways).set({
        closedAt: new Date(),
        results: scores.map(s => ({ userId: s.inviterId, count: s.qualified })),
      }).where(eq(giveaways.id, g.id));
      g.closedAt = new Date();
    }

    const nameOf = (id: string) => i.guild?.members.cache.get(id)?.displayName ?? `<@${id}>`;
    const png = await renderLeaderboardBanner({
      title: g.closedAt ? 'Natije' : 'Musabeghe-ye Davat',
      subtitle: `${i.guild!.name} · ${g.title}`, accent: '#9b6cff', kicker: 'DAVAT',
      rows: scores.slice(0, 8).filter(s => s.qualified > 0).map(s => ({
        name: nameOf(s.inviterId), value: `${s.qualified} nafar`, amount: s.qualified,
      })),
    }).catch(() => null);

    await i.editReply({
      components: [boardContainer(g, scores, nameOf, png ? 'giveaway.png' : undefined),
        ...(g.closedAt ? [] : [buttons()])],
      ...(png ? { files: [new AttachmentBuilder(png, { name: 'giveaway.png' })] } : {}),
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
export default command;
export { GW };
