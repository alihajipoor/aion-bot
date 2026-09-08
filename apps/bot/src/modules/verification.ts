import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits,
  type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction,
  type Guild, type GuildMember, type TextChannel, type MessageCreateOptions,
} from 'discord.js';
import { createRequest, getRequest, pendingFor, decide, attachMessage, type Gender } from '../lib/verify.js';
import { styleNickname, isolate } from '../lib/text.js';
import { logger } from '../lib/log.js';

const log = logger('verify');
export const VF = 'vf';
const enc = (...p: (string | number)[]) => [VF, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const ROLE = { boy: 'ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', girl: 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•' } as const;
const C = { brand: 0x5865f2, ok: 0x57f287, bad: 0xed4245, wait: 0xfee75c } as const;

const findChannel = (g: Guild, re: RegExp): TextChannel | null =>
  ([...g.channels.cache.values()].find(c => c.type === ChannelType.GuildText && re.test(c.name)) as TextChannel) ?? null;

const adminChannel  = (g: Guild) => findChannel(g, /𝙰𝙳𝙼𝙸𝙽-𝚅𝙴𝚁𝙸𝙵𝚈|admin-verify/i);
const logChannel    = (g: Guild) => findChannel(g, /𝙻𝙾𝙶-𝚅𝙴𝚁𝙸𝙵𝚈|log-verify/i);
const requestChannel= (g: Guild) => findChannel(g, /𝚅𝙴𝚁𝙸𝙵𝚈-𝚁𝙴𝚀𝚄𝙴𝚂𝚃|verify-request/i);

const isStaff = (m: GuildMember): boolean =>
  m.id === m.guild.ownerId ||
  m.permissions.has(PermissionFlagsBits.Administrator) ||
  m.roles.cache.some(r => ['Consultant', 'PowerAdmin', 'A I O N', 'V . Global'].includes(r.name));

/* ── the public panel ──────────────────────────────────────────── */

export function panelMessage(): MessageCreateOptions {
  return {
    components: [
      new ContainerBuilder().setAccentColor(C.brand)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '# 🌠 Khosh oomadi be AION'))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
          'Baraye dastresi be hameye channel-ha bayad verify beshi.',
          '',
          'Rooye dokmeye pain bezan va etela\'ate zir ro por kon:',
          '**Esm** · **Sen** · **Shahr** · **Jensiat**',
          '',
          '-# Darkhast beshe be admin-ha mire va zud check mishe.',
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(enc('start')).setLabel('Verify').setEmoji('✅').setStyle(ButtonStyle.Success))),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

/* ── member-facing flow ────────────────────────────────────────── */

export async function handleButton(i: ButtonInteraction): Promise<void> {
  const [step, arg] = dec(i.customId);
  const member = i.member as GuildMember;

  if (step === 'start') {
    if (member.roles.cache.some(r => r.name === ROLE.boy || r.name === ROLE.girl)) {
      await i.reply({ content: 'To ghablan verify shodi ✅', flags: MessageFlags.Ephemeral });
      return;
    }
    const existing = await pendingFor(i.guildId!, i.user.id);
    if (existing) {
      await i.reply({ content: 'Darkhaste to dar hale barresie. Sabr kon 🙏', flags: MessageFlags.Ephemeral });
      return;
    }
    const menu = new StringSelectMenuBuilder().setCustomId(enc('g'))
      .setPlaceholder('Jensiatet ro entekhab kon')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Pesar / Boy').setValue('boy').setEmoji('👦'),
        new StringSelectMenuOptionBuilder().setLabel('Dokhtar / Girl').setValue('girl').setEmoji('👧'));
    await i.reply({
      components: [new ContainerBuilder().setAccentColor(C.brand)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Ghadame 1 az 2\nJensiatet ro entekhab kon.'))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu))],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  if (step === 'ok' || step === 'no') { await handleDecision(i, step, Number(arg)); return; }

  if (step === 'why') {
    const row = await getRequest(Number(arg));
    if (!row || row.userId !== i.user.id) {
      await i.reply({ content: 'In natije male to nist.', flags: MessageFlags.Ephemeral });
      return;
    }
    await i.reply({
      content: `Darkhaste to rad shod.\n**Dalil:** ${isolate(row.declineReason ?? '—')}\n\nMitooni dobare darkhast bedi.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleSelect(i: StringSelectMenuInteraction): Promise<void> {
  const [step] = dec(i.customId);
  if (step !== 'g') return;
  const gender = i.values[0] as Gender;

  await i.showModal(new ModalBuilder().setCustomId(enc('form', gender)).setTitle('Etela\'ate verify')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Esm')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(24)
          .setPlaceholder('Esmi ke mikhay too server bashe')),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('age').setLabel('Sen')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2).setPlaceholder('18')),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('city').setLabel('Shahr')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30).setPlaceholder('Tehran')),
    ));
}

export async function handleModal(i: ModalSubmitInteraction): Promise<void> {
  const [step, arg] = dec(i.customId);

  if (step === 'form') {
    const gender = arg as Gender;
    const name = i.fields.getTextInputValue('name').trim();
    const ageRaw = i.fields.getTextInputValue('age').trim();
    const city = i.fields.getTextInputValue('city').trim();
    const age = Number(ageRaw.replace(/[^\d]/g, ''));

    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (!Number.isFinite(age) || age < 10 || age > 99) {
      await i.editReply('Sen ro dorost vared kon (bein 10 ta 99).');
      return;
    }

    const id = await createRequest({
      guildId: i.guildId!, userId: i.user.id, userTag: i.user.tag,
      name, age, city, gender,
    });

    const preview = styleNickname(name);
    const card = new ContainerBuilder().setAccentColor(C.wait)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('### 🕐 Darkhaste verify'))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `**User**  <@${i.user.id}>  ${isolate(i.user.tag)}`,
        `**Esm**  ${isolate(name)}`,
        `**Sen**  ${age}`,
        `**Shahr**  ${isolate(city)}`,
        `**Jensiat**  ${gender === 'boy' ? '👦 Pesar' : '👧 Dokhtar'}`,
        `**Nick e nahayi**  ${preview}`,
        `-# Request #${id}`,
      ].join('\n')))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('ok', id)).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(enc('no', id)).setLabel('Decline').setEmoji('✖️').setStyle(ButtonStyle.Danger)));

    const ch = adminChannel(i.guild!);
    if (!ch) { await i.editReply('Channel e admin-verify peyda nashod. Be admin begoo.'); return; }
    const msg = await ch.send({ components: [card], flags: MessageFlags.IsComponentsV2 });
    await attachMessage(id, msg.id);

    await i.editReply('Darkhastet ferestade shod ✅ Admin-ha zud check mikonan.');
    log.info(`verify request #${id} from ${i.user.tag}`);
    return;
  }

  if (step === 'nr') { await submitDecline(i, Number(arg)); return; }
}

/* ── staff decisions ───────────────────────────────────────────── */

async function handleDecision(i: ButtonInteraction, step: 'ok' | 'no', id: number): Promise<void> {
  const staff = i.member as GuildMember;
  if (!isStaff(staff)) {
    await i.reply({ content: 'Faghat admin-ha mitunan in ro barresi konan.', flags: MessageFlags.Ephemeral });
    return;
  }
  const row = await getRequest(id);
  if (!row) { await i.reply({ content: 'In darkhast peyda nashod.', flags: MessageFlags.Ephemeral }); return; }
  if (row.status !== 'pending') {
    await i.reply({ content: `In darkhast ghablan ${row.status === 'approved' ? 'approve' : 'reject'} shode.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (step === 'no') {
    await i.showModal(new ModalBuilder().setCustomId(enc('nr', id)).setTitle('Dalile rad kardan')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('Chera rad shod?')
          .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(300))));
    return;
  }

  await i.deferUpdate();
  const guild = i.guild!;
  const member = await guild.members.fetch(row.userId).catch(() => null);
  if (!member) {
    await decide(id, { status: 'declined', reviewerId: i.user.id, reviewerTag: i.user.tag, declineReason: 'user left' });
    await i.message.edit({ components: [resultCard('gone', row, i.user.id)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const roleName = ROLE[row.gender as Gender];
  const role = guild.roles.cache.find(r => r.name === roleName);
  const nick = styleNickname(row.name);

  try {
    if (role) await member.roles.add(role, `verified by ${i.user.tag}`);
    // Nickname changes fail for members above the bot; not fatal.
    await member.setNickname(nick, `verified by ${i.user.tag}`).catch(e =>
      log.warn(`could not set nickname for ${member.user.tag}: ${e.message}`));

    await decide(id, { status: 'approved', reviewerId: i.user.id, reviewerTag: i.user.tag, appliedNick: nick });
    await i.message.edit({ components: [resultCard('ok', row, i.user.id, nick)], flags: MessageFlags.IsComponentsV2 });

    await logChannel(guild)?.send({
      components: [new ContainerBuilder().setAccentColor(C.ok)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `✅ **Approve** — <@${member.id}> (${isolate(row.name)}, ${row.age}, ${isolate(row.city ?? '—')}) ` +
          `tavassote <@${i.user.id}> tayid shod.\n-# Request #${id} · nick: ${nick}`))],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});

    await member.send(`Verify shodi ✅ Khosh oomadi be AION!\nEsmet shod: ${nick}`).catch(() => {});
    log.info(`verify #${id} approved for ${member.user.tag} by ${i.user.tag}`);
  } catch (e) {
    log.error('approve failed', e);
    await i.followUp({ content: 'Nashod — ehtemalan bot dastresi nadare.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function submitDecline(i: ModalSubmitInteraction, id: number): Promise<void> {
  await i.deferUpdate();
  const reason = i.fields.getTextInputValue('reason').trim();
  const row = await getRequest(id);
  if (!row) return;

  await decide(id, { status: 'declined', reviewerId: i.user.id, reviewerTag: i.user.tag, declineReason: reason });
  await i.message?.edit({ components: [resultCard('no', row, i.user.id, undefined, reason)], flags: MessageFlags.IsComponentsV2 });

  const guild = i.guild!;
  const member = await guild.members.fetch(row.userId).catch(() => null);

  await logChannel(guild)?.send({
    components: [new ContainerBuilder().setAccentColor(C.bad)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `✖️ **Decline** — <@${row.userId}> tavassote <@${i.user.id}> rad shod.\n` +
        `**Dalil:** ${isolate(reason)}\n-# Request #${id}`))],
    flags: MessageFlags.IsComponentsV2,
  }).catch(() => {});

  // Prefer a DM. Iranian users very often have DMs closed, so fall back to a
  // note in the verify channel that only they can open.
  const dmOk = await member?.send(
    `Darkhaste verify e to rad shod.\n**Dalil:** ${reason}\n\nMitooni dorostesh koni va dobare darkhast bedi.`,
  ).then(() => true).catch(() => false);

  if (!dmOk) {
    await requestChannel(guild)?.send({
      components: [new ContainerBuilder().setAccentColor(C.bad)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `<@${row.userId}> darkhaste verify et barresi shod — baraye didane natije dokmeye pain ro bezan.`))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(enc('why', id)).setLabel('Natije').setEmoji('📩').setStyle(ButtonStyle.Secondary)))],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
  }
  log.info(`verify #${id} declined by ${i.user.tag}`);
}

function resultCard(kind: 'ok' | 'no' | 'gone', row: { userId: string; name: string; age: number | null; city: string | null; gender: string | null }, staffId: string, nick?: string, reason?: string) {
  const head = kind === 'ok' ? '### ✅ Approve shod' : kind === 'no' ? '### ✖️ Rad shod' : '### ⚠️ User raft';
  const accent = kind === 'ok' ? C.ok : kind === 'no' ? C.bad : 0x99aab5;
  return new ContainerBuilder().setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(head))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `**User**  <@${row.userId}>`,
      `**Esm**  ${isolate(row.name)}  ·  **Sen**  ${row.age ?? '—'}  ·  **Shahr**  ${isolate(row.city ?? '—')}`,
      `**Jensiat**  ${row.gender === 'boy' ? '👦 Pesar' : '👧 Dokhtar'}`,
      ...(nick ? [`**Nick**  ${nick}`] : []),
      ...(reason ? [`**Dalil**  ${isolate(reason)}`] : []),
      `**Tavassote**  <@${staffId}>`,
    ].join('\n')));
}
