import {
  SlashCommandBuilder, MessageFlags, AttachmentBuilder, PermissionFlagsBits,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder,
  MediaGalleryItemBuilder, type GuildMember,
} from 'discord.js';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb, giveaways } from '@aion/db';
import { scoreInvites, REASON_TEXT, type Score } from '../lib/invites.js';
import { renderLeaderboardBanner } from '../lib/banner.js';
import { hasRole } from '../lib/roles.js';
import type { Command } from '../types.js';

const MEDALS = ['🥇', '🥈', '🥉'];
const ACCENT = 0x9b6cff;

const isAdmin = (m: GuildMember) =>
  m.permissions.has(PermissionFlagsBits.ManageGuild) ||
  hasRole(m, ['Consultant', 'PowerAdmin', 'Dev']);

/** The one running giveaway, or nothing. Only one is open at a time. */
async function current(guildId: string) {
  const [row] = await getDb().select().from(giveaways)
    .where(and(eq(giveaways.guildId, guildId), isNull(giveaways.closedAt)))
    .orderBy(desc(giveaways.id)).limit(1);
  return row ?? null;
}

const stamp = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:R>`;

/**
 * Places are ranked, with a floor per place so a prize cannot be won on a
 * handful of invites. A floor is a bar to clear, not a queue position: if the
 * runner-up misses second place's floor, second place goes unawarded rather
 * than sliding down to whoever is next.
 */
function places(scores: Score[], floors: number[]) {
  return scores.slice(0, floors.length).map((s, i) => ({
    score: s, place: i + 1, floor: floors[i] ?? 0, won: s.qualified >= (floors[i] ?? 0),
  }));
}

function board(g: { title: string; floors: number[]; endsAt: Date; closedAt: Date | null },
               scores: Score[], nameOf: (id: string) => string, file?: string) {
  const c = new ContainerBuilder().setAccentColor(ACCENT);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `# 🎁 ${g.title}\n${g.closedAt ? '**Tamoom shod**' : `Ta ${stamp(g.endsAt)}`}`));
  if (file) c.addMediaGalleryComponents(new MediaGalleryBuilder()
    .addItems(new MediaGalleryItemBuilder().setURL(`attachment://${file}`)));
  c.addSeparatorComponents(new SeparatorBuilder());

  if (scores.length === 0) {
    c.addTextDisplayComponents(new TextDisplayBuilder()
      .setContent('_Hanooz kasi davat nakarde._'));
    return c;
  }

  const top = places(scores, g.floors);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    top.map(p =>
      `${MEDALS[p.place - 1]} **${nameOf(p.score.inviterId)}** — **${p.score.qualified}** nafar` +
      (p.won ? '' : ` · _hadeaghal ${p.floor} lazem_`)).join('\n')));

  const rest = scores.slice(g.floors.length, 10);
  if (rest.length) {
    c.addSeparatorComponents(new SeparatorBuilder());
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      rest.map((s, i) => `\`${i + g.floors.length + 1}.\` ${nameOf(s.inviterId)} — ${s.qualified}`).join('\n')));
  }

  c.addSeparatorComponents(new SeparatorBuilder());
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    '-# Hesab mishe: har nafar faghat yek bar · account bayad balaye 30 rooz bashe · bayad verify kone\n' +
    '-# `/giveaway man` — bebin ki barat hesab shode va ki na'));
  return c;
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
      .addIntegerOption(o => o.setName('days').setDescription('Chand rooz?').setRequired(true)
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
    const nameOf = (id: string) => i.guild?.members.cache.get(id)?.displayName ?? `<@${id}>`;

    if (['start', 'close', 'cancel', 'review', 'check'].includes(sub) && !isAdmin(member)) {
      await i.reply({ content: 'Faghat admin-ha.', flags: MessageFlags.Ephemeral });
      return;
    }

    /* ── start ─────────────────────────────────────────────────── */
    if (sub === 'start') {
      if (await current(guildId)) {
        await i.reply({ content: 'Yek musabeghe alan bazast. Aval `/giveaway close` ya `cancel`.',
          flags: MessageFlags.Ephemeral });
        return;
      }
      const days = i.options.getInteger('days')!;
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
        'Faghat davat-haye az alan be bad hesab mishe.', flags: MessageFlags.Ephemeral });
      return;
    }

    const g = await current(guildId);

    /* ── cancel ────────────────────────────────────────────────── */
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

    /* ── personal breakdown ────────────────────────────────────── */
    if (sub === 'man' || sub === 'check') {
      const who = sub === 'check' ? i.options.getUser('user')!.id : i.user.id;
      const s = scores.find(x => x.inviterId === who);
      const rank = scores.findIndex(x => x.inviterId === who) + 1;
      if (!s) { await i.editReply('Hanooz hich davati sabt nashode.'); return; }

      // Presence is read from the guild, not from the stored leave stamp, so it
      // is right for rows that predate that column too.
      const here = (id: string) => i.guild?.members.cache.has(id) ?? false;
      const line = (v: typeof s.invitees[number]) =>
        `${v.reason === 'ok' ? '✅' : '❌'} <@${v.userId}>` +
        (v.reason === 'ok' ? '' : ` — ${REASON_TEXT[v.reason]}`) +
        (here(v.userId) ? '' : ' · _raft_');

      const ok = s.invitees.filter(v => v.reason === 'ok');
      const no = s.invitees.filter(v => v.reason !== 'ok');
      const body = [
        `## 🎟 ${nameOf(who)}`,
        `**${s.qualified}** davat-e ghabel-e ghabool${rank ? ` · rotbe **${rank}**` : ''}`,
        `-# ${ok.filter(v => here(v.userId)).length} nafar hanooz to server-an · raftan az emtiaz kam nemikone`,
        '',
        ...ok.slice(0, 25).map(line),
        ...(no.length ? ['', '**Hesab nashode:**', ...no.slice(0, 15).map(line)] : []),
      ].join('\n');

      await i.editReply(body.slice(0, 3900));
      return;
    }

    /* ── review: attributions the bot inferred ─────────────────── */
    if (sub === 'review') {
      const flagged = scores.flatMap(s => s.invitees
        .filter(v => v.guessed && v.reason === 'ok')
        .map(v => `• <@${v.userId}> → <@${s.inviterId}>`));
      await i.editReply(flagged.length
        ? ['**Davat-haye hadsi** — bot motmaen nabood ki davateshun karde.',
           'Ina meghdar-e kami-an va meemoolan dorostan, vali ghabl az jayeze yek negah behesh bendaz.',
           '', ...flagged.slice(0, 40)].join('\n')
        : 'Hame-ye davat-ha ghat\'i sabt shodan — hich mored-e hadsi nist ✅');
      return;
    }

    /* ── board / close ─────────────────────────────────────────── */
    if (sub === 'close') {
      await getDb().update(giveaways).set({
        closedAt: new Date(),
        results: scores.map(s => ({ userId: s.inviterId, count: s.qualified })),
      }).where(eq(giveaways.id, g.id));
      g.closedAt = new Date();
    }

    const png = await renderLeaderboardBanner({
      title: g.closedAt ? 'Natije' : 'Musabeghe-ye Davat',
      subtitle: `${i.guild!.name} · ${g.title}`,
      accent: '#9b6cff', kicker: 'DAVAT',
      rows: scores.slice(0, 8).filter(s => s.qualified > 0).map(s => ({
        name: nameOf(s.inviterId), value: `${s.qualified} nafar`, amount: s.qualified,
      })),
    }).catch(() => null);

    await i.editReply({
      components: [board(g, scores, nameOf, png ? 'giveaway.png' : undefined)],
      ...(png ? { files: [new AttachmentBuilder(png, { name: 'giveaway.png' })] } : {}),
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
export default command;
