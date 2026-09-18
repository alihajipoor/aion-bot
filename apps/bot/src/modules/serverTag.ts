import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type Guild, type ButtonInteraction,
} from 'discord.js';
import { isolate, num } from '../lib/text.js';
import { logger } from '../lib/log.js';

const log = logger('servertag');

/**
 * The server tag, and the honest limits of what a bot can do about it.
 *
 * The obvious thing to build here is a button that puts the tag on somebody's
 * profile. It cannot exist. A tag lives on `primary_guild` on the *user*, and
 * the only endpoint that writes a user profile is PATCH /users/@me — the bot's
 * own. There is no OAuth scope for another person's profile either, which is
 * deliberate on Discord's part: what your name looks like everywhere on the
 * platform is not something a server's bot gets to decide.
 *
 * So the buttons do the two things that are genuinely possible and genuinely
 * useful: tell you exactly which four taps to make, and show how many people
 * have already made them. The first saves the hunt through settings; nobody
 * finds "Profiles → scroll → Select" on their own.
 *
 * Reading is fine — `primary_guild` comes back on user objects — which is why
 * the count is real rather than a guess.
 */

export const TAG_ID = 'tg';
const enc = (...p: string[]) => [TAG_ID, ...p].join('|');

const ACCENT = 0x4aa6ff;

interface PrimaryGuild {
  identity_guild_id: string | null;
  identity_enabled: boolean;
  tag: string | null;
}

/** Everyone currently wearing this server's tag, by id. */
async function wearers(guild: Guild): Promise<{ ids: string[]; tag: string | null }> {
  const ids: string[] = [];
  let tag: string | null = null;
  let after = '0';

  // Paged rather than one shot: the member list outgrows 1000 eventually and a
  // count that silently stops at the first page is worse than no count.
  for (;;) {
    const page = await guild.client.rest.get(
      `/guilds/${guild.id}/members?limit=1000&after=${after}`,
    ) as { user: { id: string; primary_guild?: PrimaryGuild | null } }[];
    if (!page.length) break;
    for (const m of page) {
      const p = m.user.primary_guild;
      if (p?.identity_enabled && p.identity_guild_id === guild.id) {
        ids.push(m.user.id);
        tag ??= p.tag;
      }
    }
    after = page[page.length - 1]!.user.id;
    if (page.length < 1000) break;
  }
  return { ids, tag };
}

/**
 * The announcement itself.
 *
 * The tag is asked for once and worn everywhere, so the pitch is what it does
 * off this server rather than on it. The one-at-a-time rule is stated up front
 * on purpose: most people who will not switch are already wearing somebody
 * else's, and finding that out after digging through settings is the annoying
 * way to learn it.
 */
export function tagCard(tag: string): {
  components: unknown[]; flags: number; allowedMentions: { parse: string[] };
} {
  const box = new ContainerBuilder().setAccentColor(ACCENT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `# 🏷️ تگ سرور اومد — \`${tag}\``))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `از این به بعد می‌تونی تگ سرور رو کنار اسمت داشته باشی — **همه‌جای دیسکورد**، نه فقط اینجا.`,
      'هر کسی پروفایلت رو ببینه، نشان ما رو کنار اسمت می‌بینه.',
      '',
      '**یادت باشه:** هر کس فقط تگ **یک سرور** رو می‌تونه هم‌زمان داشته باشه.',
      'اگه الان تگ سرور دیگه‌ای رو گذاشتی، با انتخاب این، جایگزین می‌شه.',
      '',
      'دکمه‌ی زیر رو بزن تا مرحله‌به‌مرحله بگم چطوری بذاریش.',
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '-# وقتی کسی روی تگت بزنه، پروفایل سرور باز می‌شه و می‌تونه مستقیم عضو بشه.'))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(enc('how')).setLabel('چطوری بذارمش؟')
        .setEmoji('⚙️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(enc('who')).setLabel('کیا گذاشتن؟')
        .setEmoji('👥').setStyle(ButtonStyle.Secondary)));

  return {
    components: [box],
    flags: MessageFlags.IsComponentsV2 as number,
    allowedMentions: { parse: [] as string[] },
  };
}

/**
 * The steps, taken from Discord's own help article rather than from memory.
 *
 * Menu names are the one thing that must not be approximated — a person who
 * cannot find "Profiles" gives up rather than hunting, and instructions that
 * are nearly right read as the bot being broken.
 */
const HOW = (serverName: string) => [
  `## ⚙️ گذاشتن تگ سرور`,
  '',
  '**کامپیوتر و مرورگر**',
  '`1.` روی چرخ‌دنده ⚙️ کنار اسم کاربریت بزن (پایین-چپ) تا **User Settings** باز بشه',
  '`2.` از منوی کناری **Profiles** رو بزن',
  '`3.` بیا پایین تا **Server Tag** رو ببینی، بعد **Select** رو بزن',
  `\`4.\` **${serverName}** رو انتخاب کن — خودکار ذخیره می‌شه`,
  '',
  '**موبایل**',
  '`1.` روی عکس پروفایلت پایین-**راست** بزن',
  '`2.` **Edit Profile** رو بزن',
  `\`3.\` بیا پایین تا **Server Tags**، بعد **${serverName}** رو انتخاب کن`,
  '',
  '**برداشتنش:** کنار تگ فعلی، ضربدر ❌ رو بزن.',
  '',
  '-# فقط تگ یک سرور رو می‌شه هم‌زمان داشت.',
  '-# اگه ما بعداً تگ رو عوض کنیم، باید دوباره انتخابش کنی.',
].join('\n');

export async function handleButton(i: ButtonInteraction): Promise<void> {
  const what = i.customId.split('|')[1];
  const guild = i.guild;
  if (!guild) return;

  if (what === 'how') {
    // No database, no member scan — answer immediately. This is the button
    // most people press, and it has nothing to wait for.
    await i.reply({ content: HOW(guild.name), flags: MessageFlags.Ephemeral });
    return;
  }

  // Counting means paging the member list, which is well past the three
  // seconds Discord allows before it calls the interaction dead.
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const { ids, tag } = await wearers(guild);
    const mine = ids.includes(i.user.id);
    const names = ids
      .map(id => guild.members.cache.get(id)?.displayName)
      .filter((n): n is string => Boolean(n))
      .slice(0, 30);

    await i.editReply([
      `## 👥 ${num(ids.length)} نفر تگ${tag ? ` \`${tag}\`` : ''} رو گذاشتن`,
      mine ? '-# تو هم جزوشونی. ✅' : '-# تو هنوز نذاشتیش.',
      '',
      ...names.map(n => `• ${isolate(n)}`),
      ...(ids.length > names.length ? [`-# و ${num(ids.length - names.length)} نفر دیگه`] : []),
    ].join('\n').slice(0, 1900));
  } catch (e) {
    log.error('tag count failed', e);
    await i.editReply('نشد بشمرم. یکم بعد دوباره بزن.');
  }
}

/*
 * There is deliberately no stored copy of the tag text in this process.
 *
 * A bot cannot read its own guild's tag — it is only visible on the users
 * wearing it — so the first version of this file kept a `TAG_TEXT` constant and
 * a setter. The setter could only ever be called by the posting tool, which is
 * a different process, so the bot's copy would have sat at whatever was typed
 * here on the day it was written and gone stale the first time the tag was
 * edited in Server Settings. Exactly the failure the tool's own comment warns
 * about, reintroduced one file over.
 *
 * So: the announcement takes the tag as an argument, read live at post time,
 * and the instructions name the server instead — which is what the settings
 * screen actually lists anyway.
 */

export { wearers };
