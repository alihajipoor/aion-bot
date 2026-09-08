import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type StringSelectMenuInteraction,
} from 'discord.js';
import {
  CATALOGUE, SCENARIOS, scenarioOf, distribution, sideCounts,
  MAFIA_DEFAULTS, ESM_DEFAULTS, ESM_COLUMNS, SOALI_DEFAULTS,
  type GameKey, type MafiaConfig, type EsmFamilConfig, type SoaliConfig,
} from './games.js';

export const WZ = 'wz';
const enc = (...p: (string | number)[]) => [WZ, ...p].join('|');
export const decWizard = (s: string) => s.split('|').slice(1);

const C = { mafia: 0xed4245, esm: 0x4aa6ff, soali: 0xfee75c, custom: 0x9b6cff } as const;
const ACCENT: Record<GameKey, number> = {
  mafia: C.mafia, esmfamil: C.esm, bistsoali: C.soali, custom: C.custom,
};

/**
 * Wizard state lives in memory, not the database. A half-filled setup that
 * someone walked away from is not worth a row, and it expires on its own.
 */
export interface Draft {
  game: GameKey;
  players: number;
  mafia: MafiaConfig;
  esm: EsmFamilConfig;
  soali: SoaliConfig;
  touched: number;
}

const drafts = new Map<string, Draft>();
const TTL = 20 * 60_000;

export function draftFor(userId: string, game?: GameKey): Draft {
  const existing = drafts.get(userId);
  if (existing && (!game || existing.game === game)) {
    existing.touched = Date.now();
    return existing;
  }
  const fresh: Draft = {
    game: game ?? 'mafia',
    players: 9,
    mafia: { ...MAFIA_DEFAULTS, optionalRoles: [] },
    esm: { ...ESM_DEFAULTS, columns: [...ESM_DEFAULTS.columns] },
    soali: { ...SOALI_DEFAULTS },
    touched: Date.now(),
  };
  drafts.set(userId, fresh);
  return fresh;
}

export const clearDraft = (userId: string) => drafts.delete(userId);

setInterval(() => {
  const now = Date.now();
  for (const [id, d] of drafts) if (now - d.touched > TTL) drafts.delete(id);
}, 5 * 60_000).unref?.();

/* ── mafia setup ───────────────────────────────────────────────── */

const OPTION_FLAGS: { key: keyof MafiaConfig; label: string; hint: string }[] = [
  { key: 'autoMuteNight',  label: 'Mute e khodkare shab',   hint: 'Shab hame saket mishan' },
  { key: 'deadStayMuted',  label: 'Morde ha mute bemoonan', hint: 'Ta akhare baazi' },
  { key: 'revealOnDeath',  label: 'Naghsh ba marg lo bere', hint: 'Baraye tazekar ha khoobe' },
  { key: 'mafiaRoom',      label: 'Otagh e mafia',          hint: 'Chat e khosoosi baraye team' },
];

function mafiaScreen(d: Draft) {
  const sc = scenarioOf(d.mafia.scenario);
  const roles = distribution(sc, d.players, d.mafia.optionalRoles);
  const sides = sideCounts(roles);
  const fits = d.players >= sc.min && d.players <= sc.max;

  const table = roles.map((r, i) =>
    `\`${String(i + 1).padStart(2, ' ')}\` ${r.side === 'mafia' ? '🔴' : r.side === 'solo' ? '🟣' : '🟢'} ${r.fa}`,
  );
  const half = Math.ceil(table.length / 2);

  const box = new ContainerBuilder().setAccentColor(C.mafia)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## 🕵️ Setup — Mafia\n-# Sanario, tedad va naghsh ha ro tanzim kon. Har chizi avaz koni, jadval zir hamoon lahze update mishe.`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `**${sc.fa}** · ${d.players} bazikon${fits ? '' : `  ⚠️ in sanario ${sc.min}–${sc.max} nafar mikhad`}`,
      `🔴 **${sides.mafia}** mafia   🟢 **${sides.town}** shahr${sides.solo ? `   🟣 **${sides.solo}** solo` : ''}`,
      '',
      table.slice(0, half).join('\n'),
      table.slice(half).join('\n'),
    ].filter(Boolean).join('\n')));

  box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('m', 'scenario'))
      .setPlaceholder(`Sanario — ${sc.fa}`)
      .addOptions(SCENARIOS.map(s => new StringSelectMenuOptionBuilder()
        .setLabel(s.fa).setValue(s.key).setDescription(`${s.min}–${s.max} nafar · ${s.blurb}`.slice(0, 100))
        .setDefault(s.key === sc.key)))));

  const counts = Array.from({ length: Math.min(25, sc.max - sc.min + 1) }, (_, i) => sc.min + i);
  box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('m', 'players'))
      .setPlaceholder(`Tedade bazikon — ${d.players}`)
      .addOptions(counts.map(n => new StringSelectMenuOptionBuilder()
        .setLabel(`${n} nafar`).setValue(String(n)).setDefault(n === d.players)))));

  const optional = sc.roles.filter(r => r.optional);
  if (optional.length) {
    box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(enc('m', 'roles'))
        .setPlaceholder('Naghsh haye ekhtiari')
        .setMinValues(0).setMaxValues(optional.length)
        .addOptions(optional.map(r => new StringSelectMenuOptionBuilder()
          .setLabel(r.fa).setValue(r.key).setDescription(r.blurb.slice(0, 100))
          .setDefault(d.mafia.optionalRoles.includes(r.key))))));
  }

  box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('m', 'flags'))
      .setPlaceholder('Tanzimat')
      .setMinValues(0).setMaxValues(OPTION_FLAGS.length)
      .addOptions(OPTION_FLAGS.map(f => new StringSelectMenuOptionBuilder()
        .setLabel(f.label).setValue(f.key).setDescription(f.hint)
        .setDefault(Boolean(d.mafia[f.key]))))));

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('timers', 'mafia')).setLabel('Timer ha').setEmoji('⏱').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('create', 'mafia')).setLabel('Besaz').setEmoji('✅')
      .setStyle(ButtonStyle.Success).setDisabled(!fits),
    new ButtonBuilder().setCustomId(enc('cancel')).setLabel('Bikhial').setStyle(ButtonStyle.Secondary)));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

/* ── esm famil setup ───────────────────────────────────────────── */

function esmScreen(d: Draft) {
  const box = new ContainerBuilder().setAccentColor(C.esm)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## ✍️ Setup — Esm Famil\n-# Sotoon ha, tedade dast va vaghte har dast.'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `**Sotoon ha** ${d.esm.columns.join(' · ')}`,
      `**Dast ha** ${d.esm.rounds}   ·   **Vaght** ${d.esm.roundSeconds} sanie`,
      '',
      '**Emtiaz**  `20` tanha khodet · `10` dorost · `5` tekrari · `0` khali',
      '-# Javab ha normalize mishan (ي/ی · ك/ک · nim-fasele), pas tekrari dorost tashkhis dade mishe.',
    ].join('\n')));

  box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('e', 'columns'))
      .setPlaceholder('Sotoon ha (max 5)').setMinValues(2).setMaxValues(5)
      .addOptions(ESM_COLUMNS.map(c => new StringSelectMenuOptionBuilder()
        .setLabel(c).setValue(c).setDefault(d.esm.columns.includes(c))))));

  box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('e', 'rounds'))
      .setPlaceholder(`Tedade dast — ${d.esm.rounds}`)
      .addOptions([3, 5, 7, 10].map(n => new StringSelectMenuOptionBuilder()
        .setLabel(`${n} dast`).setValue(String(n)).setDefault(n === d.esm.rounds)))));

  box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('e', 'seconds'))
      .setPlaceholder(`Vaghte har dast — ${d.esm.roundSeconds}s`)
      .addOptions([45, 60, 90, 120, 180].map(n => new StringSelectMenuOptionBuilder()
        .setLabel(`${n} sanie`).setValue(String(n)).setDefault(n === d.esm.roundSeconds)))));

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('create', 'esmfamil')).setLabel('Besaz').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(enc('cancel')).setLabel('Bikhial').setStyle(ButtonStyle.Secondary)));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

/* ── 20 soali setup ────────────────────────────────────────────── */

function soaliScreen(d: Draft) {
  const box = new ContainerBuilder().setAccentColor(C.soali)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## ❓ Setup — 20 Soali\n-# Tedade soal, rahnamayi va hads.'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `**Soal** ${d.soali.questionLimit}   ·   **Rahnama** ${d.soali.hintsAllowed}   ·   **Hads** ${d.soali.guessLimit}`,
      '',
      '-# Javab e sahebe mozoo ba dokme miad: bale / na / ta hadi.',
    ].join('\n')));

  const sel = (field: 'questionLimit' | 'hintsAllowed' | 'guessLimit', label: string, opts: number[]) =>
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(enc('s', field))
        .setPlaceholder(`${label} — ${d.soali[field]}`)
        .addOptions(opts.map(n => new StringSelectMenuOptionBuilder()
          .setLabel(`${n}`).setValue(String(n)).setDefault(n === d.soali[field]))));

  box.addActionRowComponents(sel('questionLimit', 'Tedade soal', [10, 15, 20, 25, 30]));
  box.addActionRowComponents(sel('hintsAllowed', 'Rahnama', [0, 1, 2, 3]));
  box.addActionRowComponents(sel('guessLimit', 'Hads', [1, 2, 3, 5]));
  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('create', 'bistsoali')).setLabel('Besaz').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(enc('cancel')).setLabel('Bikhial').setStyle(ButtonStyle.Secondary)));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

function customScreen() {
  const def = CATALOGUE.custom;
  const box = new ContainerBuilder().setAccentColor(C.custom)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${def.emoji} Setup — Custom\n${def.blurb}`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      def.does.map(d => `> ${d}`).join('\n')))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(enc('create', 'custom')).setLabel('Besaz').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(enc('cancel')).setLabel('Bikhial').setStyle(ButtonStyle.Secondary)));
  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

export function screenFor(d: Draft) {
  return d.game === 'mafia' ? mafiaScreen(d)
    : d.game === 'esmfamil' ? esmScreen(d)
    : d.game === 'bistsoali' ? soaliScreen(d)
    : customScreen();
}

/* ── timers ────────────────────────────────────────────────────── */

export function timerModal(d: Draft): ModalBuilder {
  const num = (id: string, label: string, value: number) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label)
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(4)
        .setValue(String(value)));
  return new ModalBuilder().setCustomId(enc('timers')).setTitle('Timer haye Mafia')
    .addComponents(
      num('night', 'Shab (sanie)', d.mafia.nightSeconds),
      num('day', 'Rooz (sanie)', d.mafia.daySeconds),
      num('defense', 'Defa (sanie)', d.mafia.defenseSeconds),
      num('vote', 'Ray giri (sanie)', d.mafia.voteSeconds));
}

/** Applies one wizard control and returns the redrawn screen. */
export function applyChange(d: Draft, group: string, field: string, values: string[]) {
  if (group === 'm') {
    if (field === 'scenario') { d.mafia.scenario = values[0]!; d.mafia.optionalRoles = []; }
    if (field === 'players') d.players = Number(values[0]);
    if (field === 'roles') d.mafia.optionalRoles = values;
    if (field === 'flags') {
      for (const f of OPTION_FLAGS) (d.mafia[f.key] as boolean) = values.includes(f.key);
    }
  } else if (group === 'e') {
    if (field === 'columns') d.esm.columns = values;
    if (field === 'rounds') d.esm.rounds = Number(values[0]);
    if (field === 'seconds') d.esm.roundSeconds = Number(values[0]);
  } else if (group === 's') {
    const f = field as keyof SoaliConfig;
    d.soali[f] = Number(values[0]);
  }
  d.touched = Date.now();
  return screenFor(d);
}

export const configOf = (d: Draft): Record<string, unknown> =>
  d.game === 'mafia' ? { ...d.mafia, players: d.players }
  : d.game === 'esmfamil' ? { ...d.esm }
  : d.game === 'bistsoali' ? { ...d.soali }
  : {};

export { ACCENT };
export type { GameKey };
