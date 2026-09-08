import {
  SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder, AttachmentBuilder,
  type TextChannel,
} from 'discord.js';
import { settings } from '../lib/settings.js';
import { humanDuration } from '../lib/text.js';
import { renderHeaderBanner } from '../lib/banner.js';
import type { Command } from '../types.js';

const GUIDE_CHANNEL = /ᴀɪᴏɴ-ɢᴜɪᴅᴇ|aion-guide/i;

function page(accent: number, title: string, body: string[]): ContainerBuilder {
  return new ContainerBuilder().setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body.join('\n')));
}

/** Rebuilt from live settings, so the guide can never drift from behaviour. */
function pages(): ContainerBuilder[] {
  const s = settings();
  const durations = s.moderation.durationsMinutes.slice(0, 5).map(humanDuration).join(' · ');

  return [
    page(0x5865f2, '📖 AION — Rahnamaye Admin', [
      'Hameye emkanate bot, ba mesal. In safhe khodkar sakhte mishe — ba `/guide` dobare besazesh.',
      '',
      '**Section-ha**  🏛️ Public (Townhall) · 🎮 Game (GameTown) · 🎭 Entertainment (Quidditch)',
      'Har admin faghat too section e khodesh dastresi dare. In ghanoon dar sathe Discord ejra mishe, na faghat too code.',
    ]),

    page(0xed4245, '⚖️ Punish kardan', [
      '**`/punish user:@kasi`**',
      'Faghat too channel e `𝙱𝘼𝙉-𝙎𝙀𝘾𝙏𝙄𝙊𝙉` ya `𝙋𝙐𝙉𝙄𝙎𝙃𝙈𝙀𝙉𝙏` e hamoon section kar mikone.',
      '',
      '**Marahel:** Section → Warn / Mute / Ban → Moddat → Dalil',
      '(Warn moddat nadare — mostaghim mire soraghe dalil.)',
      `**Moddat-haye amade:** ${durations} …`,
      '',
      '**Ki chikar mitoone bokone**',
      '`Moderator` → faghat **Mute**',
      '`Global` → **Mute + Ban**',
      '`PowerAdmin` / `Consultant` / `Dev` → hameye section-ha, bedoone mahdoodiat',
      '',
      `**Cooldown:** Global-ha bayad ${s.moderation.globalCooldownSec} saniye bein har punish sabr konan. PowerAdmin va balatar moaf hastan.`,
      '',
      '**Warn chie?**',
      'Hich mahdoodiati nemizare — faghat sabt mishe. Baraye oon hameye ettefagh-haye koochik ke na mute mikhan na ban, vali bayad yadeshoon bemoone.',
      `Bot sabegheye ${s.moderation.warnWindowDays} rooze akhar ro moghe punish neshoon mide, va bad az **${s.moderation.warnEscalateAt}** ta sabeghe khodesh ye moddate tolani tar pishnahad mikone. Pishnahad e — majbur nisti.`,
      '',
      '**Farghe Mute va Ban**',
      '`Mute` → mitoone bebine va bia tu, vali nemitoone harf bezane ya message bede — **faghat too hamoon section**',
      '`Ban` → kolan oon section ro nemibine. Section-haye dige kamelan azad.',
      '',
      '**Mesal:** `/punish user:@ali` → Public → Mute → 1 saat → "fohsh dadan too voice"',
    ]),

    page(0x57f287, '🔓 Bardashtane punishment', [
      '**Se rah:**',
      '1. Dokmeye **Unmute / Unban** zire hamoon payam e punishment',
      '2. **`/unpunish user:@kasi`** → az list entekhab kon',
      '3. Khodkar — vaghti moddat tamoom beshe bot khodesh barmidare',
      '',
      'Har se ta hamoon ghanoone dastresi ro daran: Public Global faghat too Public.',
    ]),

    page(0x4aa8ff, '✅ Verify', [
      '**`/verifypanel`** → panel e verify ro too channel post mikone (yek bar kafie).',
      '',
      '**Ravand:** user dokme mizane → jensiat → esm/sen/shahr → darkhast mire be `𝘼𝘿𝙈𝙄𝙉-𝙑𝙀𝙍𝙄𝙁𝙔`',
      'Onja ba **Approve** ya **Decline** tasmim begir. Decline dalil mikhad.',
      '',
      `Approve → role e jensiat + esm ba font e server (**${s.verification.nickStyle}**)`,
      'Decline → be khodesh khabar dade mishe ba dalil, faghat khodesh mibine.',
    ]),

    page(0xffd700, '🏆 Leaderboard', [
      '**`/leaderboard`** — pish-farz voice + chat ba ham',
      '`type:` Voice / Chat / Admin  ·  `period:` emrooz / 7 rooz / 30 rooz / hamishe',
      '',
      '**`/leaderboard post:`** — alan post kon (faghat admin)',
      '',
      `Khodkar: har rooz saat ${s.leaderboard.dailyHourUtc}:00 UTC too **𝙏𝙊𝙋-𝘼𝘾𝙏𝙄𝙑𝙀**, va haftegi too **ᴀᴅᴍɪɴ-ᴀᴄᴛɪᴠᴇ**.`,
      '',
      '**Voice time key hesab mishe?** vaghti AFK nisti, deaf nisti, va tanha too channel nisti.',
    ]),

    page(0x9b59b6, '🎧 Private voice', [
      'Har kas bia too **🅟 ─ PRIVET DRIVE** → room e khodesh sakhte mishe.',
      '',
      '**Dokme-haye control:** Esm · Zarfiat · Ghofl · Makhfi · Kick · Claim',
      '',
      'Admin-ha hamishe mitunan bian tu — room e private jaye kor baraye moderation nist.',
      'Vaghti khali beshe khodkar pak mishe, va tanzimat baraye dafeye bad zakhire mishe.',
    ]),

    page(0x1abc9c, '🖥️ Web panel', [
      '**https://aion.neoxify.com** — faghat `Consultant` va `Dev`.',
      '',
      '**Overview** amar zende + nemoodar · **Live voice** move/mute/kick/punish/role',
      '**Members** search + tarikhcheye har nafar · **Moderation** hameye case-ha',
      '**Verifications** approve/decline · **Logs** jostojoo bein hameye event-ha',
      '**Settings** hameye tanzimate bot bedoone restart',
      '',
      'Age role et bardashte beshe, dastresit **foran** ghat mishe.',
    ]),

    page(0x95a5a6, '📊 Log-ha', [
      'Hameye event-ha too section e **LOG** sabt mishan, va 30 rooz too panel ghabele jostojoo hastan.',
      '',
      '`ᴏᴠᴇʀᴡʀɪᴛᴇꜱ` → taghire dastresi channel-ha (mohemtarin baraye amniat)',
      '`ᴡᴇʙʜᴏᴏᴋꜱ` → sakhte webhook/integration — rah e maroof e nuke kardan',
      '`ʙᴀɴɴᴇᴅ-ʟᴏɢ` → hameye punishment-ha yekja',
      '',
      '**`/status`** → vaziate bot: uptime, ping, memory, database',
    ]),
  ];
}

/** Post on boot when the guide channel is empty, so it is never left blank. */
export async function ensureGuide(guild: import('discord.js').Guild): Promise<void> {
  const ch = [...guild.channels.cache.values()]
    .find(c => c.type === ChannelType.GuildText && GUIDE_CHANNEL.test(c.name)) as TextChannel | undefined;
  if (!ch) return;
  try {
    const existing = await ch.messages.fetch({ limit: 5 });
    if (existing.some(m => m.author.id === guild.client.user?.id)) return;
    for (const p of pages()) {
      await ch.send({ components: [p], flags: MessageFlags.IsComponentsV2 });
      await new Promise(r => setTimeout(r, 400));
    }
  } catch { /* not fatal */ }
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('guide')
    .setDescription('Rahnamaye kamele bot ro post mikone')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(i) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = i.guild!;

    const target = ([...guild.channels.cache.values()]
      .find(c => c.type === ChannelType.GuildText && GUIDE_CHANNEL.test(c.name)) as TextChannel | undefined)
      ?? (i.channel as TextChannel);

    // Clear the bot's previous guide so re-running never stacks duplicates.
    try {
      const old = await target.messages.fetch({ limit: 50 });
      const mine = old.filter(m => m.author.id === guild.client.user?.id);
      for (const m of mine.values()) await m.delete().catch(() => {});
    } catch { /* missing history permission is not fatal */ }

    // The cover carries the branding; the pages below it stay dense on purpose.
    const cover = await renderHeaderBanner({
      kicker: 'ADMIN · RAHNAMA', title: 'Rahnamaye Admin', accent: '#4aa6ff',
      subtitle: 'Hameye emkanate bot, ba mesal — khodkar az rooye tanzimate zende.',
      tags: ['PUNISH', 'VERIFY', 'LEADERBOARD', 'TEMP VOICE', 'PANEL'],
    });
    if (cover) {
      await target.send({
        components: [new ContainerBuilder().setAccentColor(0x4aa6ff)
          .addMediaGalleryComponents(new MediaGalleryBuilder()
            .addItems(new MediaGalleryItemBuilder().setURL('attachment://guide.png')))],
        files: [new AttachmentBuilder(cover, { name: 'guide.png' })],
        flags: MessageFlags.IsComponentsV2,
      });
      await new Promise(r => setTimeout(r, 400));
    }

    for (const p of pages()) {
      await target.send({ components: [p], flags: MessageFlags.IsComponentsV2 });
      await new Promise(r => setTimeout(r, 400));
    }
    await i.editReply(`Rahnama post shod too <#${target.id}> ✅`);
  },
};
export default command;
