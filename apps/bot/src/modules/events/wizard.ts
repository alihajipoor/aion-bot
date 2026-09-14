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
import { settings } from '../../lib/settings.js';
import { SCUM_ROLES } from './scum/rules.js';
import { distribution as scumDistribution } from './scum/deal.js';

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
  /**
   * Which mafia the host is setting up.
   *
   * It belongs on the draft rather than in MafiaConfig because it is written to
   * the event's state, not its config — `isScum` reads it there, and a second
   * copy in config is how the wizard and the router end up disagreeing about
   * which game is being played.
   */
  mode: 'irani' | 'scum';
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
  // Seeded from the panel's settings, so a host opens the wizard on the
  // server's house rules rather than on whatever was compiled in.
  const e = settings().events;
  const fresh: Draft = {
    game: game ?? 'mafia',
    players: 9,
    mode: 'irani',
    mafia: {
      ...MAFIA_DEFAULTS,
      scenario: e.defaultScenario || MAFIA_DEFAULTS.scenario,
      optionalRoles: [...e.optionalRoles],
      autoMuteNight: e.autoMuteNight,
      deadStayMuted: e.deadStayMuted,
      revealOnDeath: e.revealOnDeath,
      mafiaRoom: e.mafiaRoom,
      nightSeconds: e.nightSeconds,
      daySeconds: e.daySeconds,
      defenseSeconds: e.defenseSeconds,
      voteSeconds: e.voteSeconds,
    },
    esm: {
      ...ESM_DEFAULTS,
      columns: e.esmColumns.length ? [...e.esmColumns] : [...ESM_DEFAULTS.columns],
      rounds: e.esmRounds,
      roundSeconds: e.esmRoundSeconds,
      letterPool: e.esmLetterPool || ESM_DEFAULTS.letterPool,
    },
    soali: {
      questionLimit: e.soaliQuestions,
      hintsAllowed: e.soaliHints,
      guessLimit: e.soaliGuesses,
    },
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

/** Scum's own table-size range; it has no scenario to take one from. */
const SCUM_MIN = 5;
const SCUM_MAX = 20;

function mafiaScreen(d: Draft) {
  const scum = d.mode === 'scum';
  const sc = scenarioOf(d.mafia.scenario);
  // Only worked out for the Persian game. Computing it regardless was how the
  // scenario's cast ended up printed above the Scum one, two tables on a screen
  // that can only deal from a single one.
  const roles = scum ? [] : distribution(sc, d.players, d.mafia.optionalRoles);
  const sides = sideCounts(roles);
  // Scum has no scenario, so its range is its own. Reading the scenario's here
  // is what would grey out Besaz on a perfectly valid Scum table.
  const fits = scum
    ? d.players >= SCUM_MIN && d.players <= SCUM_MAX
    : d.players >= sc.min && d.players <= sc.max;

  const table = roles.map((r, i) =>
    `\`${String(i + 1).padStart(2, ' ')}\` ${r.side === 'mafia' ? '🔴' : r.side === 'solo' ? '🟣' : '🟢'} ${r.fa}`,
  );
  const half = Math.ceil(table.length / 2);

  const box = new ContainerBuilder().setAccentColor(C.mafia)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      scum
        ? '## 🃏 Setup — Mafia Scum\n-# Naghsh ha sabet-an. Faghat tedad ro entekhab kon.'
        : '## 🕵️ Setup — Mafia\n-# Sanario, tedad va naghsh ha ro tanzim kon. Har chizi avaz koni, jadval zir hamoon lahze update mishe.'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (!scum) box.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `**${sc.fa}** · ${d.players} bazikon${fits ? '' : `  ⚠️ in sanario ${sc.min}–${sc.max} nafar mikhad`}`,
      `🔴 **${sides.mafia}** mafia   🟢 **${sides.town}** shahr${sides.solo ? `   🟣 **${sides.solo}** solo` : ''}`,
      '',
      table.slice(0, half).join('\n'),
      table.slice(half).join('\n'),
    ].filter(Boolean).join('\n')));

  box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('m', 'mode'))
      .setPlaceholder(d.mode === 'scum' ? 'Halat — Mafia Scum' : 'Halat — Mafiaye Irani')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Mafiaye Irani').setValue('irani')
          .setDescription('Ray giri avval -> defa -> ejma · sanario dare')
          .setEmoji('🎲').setDefault(d.mode !== 'scum'),
        new StringSelectMenuOptionBuilder().setLabel('Mafia Scum').setValue('scum')
          .setDescription('Mostaghim ray giri, do dor · naghsh ha sabet-e')
          .setEmoji('🃏').setDefault(d.mode === 'scum'))));

  // Scum has one fixed cast rather than scenarios, so the scenario and the
  // optional-role pickers below would be choosing from a list it never reads.
  if (d.mode === 'scum') {
    const dealt = scumDistribution(d.players, d.mafia);
    const tally = dealt.reduce<Record<string, number>>((a, k) => {
      a[k] = (a[k] ?? 0) + 1; return a;
    }, {});
    const sideOf = (k: string) => SCUM_ROLES[k as keyof typeof SCUM_ROLES]?.side;
    const count = (side: string) =>
      dealt.filter(k => SCUM_ROLES[k as keyof typeof SCUM_ROLES]?.countsAs === side).length;

    box.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `**Mafia Scum** · ${d.players} bazikon`,
      `🔴 **${count('mafia')}** mafia   🟢 **${count('shahr')}** shahr`,
      '-# Natasha mafia shomorde mishe, traitor shahr — hamoon jori ke too shomaresh miad.',
      '',
      ...Object.entries(tally).map(([k, n]) => {
        const r = SCUM_ROLES[k as keyof typeof SCUM_ROLES];
        const dot = sideOf(k) === 'mafia' ? '🔴' : sideOf(k) === 'gray' ? '⚪' : '🟢';
        return `${dot} ${r?.fa ?? k}${n > 1 ? ` ×${n}` : ''}`;
      }),
    ].join('\n')));
    box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(enc('m', 'players'))
        .setPlaceholder(`Tedade bazikon — ${d.players}`)
        .addOptions(Array.from({ length: SCUM_MAX - SCUM_MIN + 1 }, (_, k) => k + SCUM_MIN).map(n =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${n} nafar`).setValue(String(n)).setDefault(n === d.players)))));
  }

  if (!scum) box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('m', 'scenario'))
      .setPlaceholder(`Sanario — ${sc.fa}`)
      .addOptions(SCENARIOS.map(s => new StringSelectMenuOptionBuilder()
        .setLabel(s.fa).setValue(s.key).setDescription(`${s.min}–${s.max} nafar · ${s.blurb}`.slice(0, 100))
        .setDefault(s.key === sc.key)))));

  const counts = Array.from({ length: Math.min(25, sc.max - sc.min + 1) }, (_, i) => sc.min + i);
  if (!scum) box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('m', 'players'))
      .setPlaceholder(`Tedade bazikon — ${d.players}`)
      .addOptions(counts.map(n => new StringSelectMenuOptionBuilder()
        .setLabel(`${n} nafar`).setValue(String(n)).setDefault(n === d.players)))));

  const optional = scum ? [] : sc.roles.filter(r => r.optional);
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
    if (field === 'mode') { d.mode = values[0] === 'scum' ? 'scum' : 'irani'; }
    else if (field === 'scenario') { d.mafia.scenario = values[0]!; d.mafia.optionalRoles = []; }
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

/** Written to the event's state, beside config but not inside it. */
export const modeOf = (d: Draft): 'irani' | 'scum' => d.game === 'mafia' ? d.mode : 'irani';

export const configOf = (d: Draft): Record<string, unknown> =>
  d.game === 'mafia' ? { ...d.mafia, players: d.players }
  : d.game === 'esmfamil' ? { ...d.esm }
  : d.game === 'bistsoali' ? { ...d.soali }
  : {};

export { ACCENT };
export type { GameKey };
