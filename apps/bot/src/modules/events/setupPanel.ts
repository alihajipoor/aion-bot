/**
 * Tanzimat — God's settings panel, inside Discord.
 *
 * docs/MAFIA.md is canonical: "God configures before the game and adjusts
 * during it." So nothing here is locked once the game starts. Every control
 * writes straight through to `config` on the event row and the screen is redrawn
 * from a fresh read of that row, never from what the last click believed — a
 * panel that shows a stale value is worse than no panel, because God trusts it
 * while narrating and only finds out at the moment the rule bites.
 *
 * Discord allows five action rows to a message and five buttons to a row, which
 * is nowhere near enough for thirteen roles, five phases, three budgets, a
 * timer and three switches. So this is a hub with four sub-screens rather than one wall: the hub
 * shows every current value as text — that is the part God actually reads
 * mid-game — and each section owns its own rows.
 *
 * The custom ids live under the mafia prefix on purpose; events/index.ts routes
 * every `mf|…` component to mafia.ts, which hands the ones below to us.
 */
import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ButtonInteraction, type StringSelectMenuInteraction, type Guild,
} from 'discord.js';
import { isolate, num } from '../../lib/text.js';
import { getEvent, mergeState, type EventRow } from './store.js';
import {
  MAFIA_DEFAULTS, PHASES, TEXT_RULE_FA,
  type MafiaConfig, type Phase, type TextRule,
} from './games.js';
import { SCUM_ROLES, canDisable, roleOf as scumRoleOf, type ScumRole } from './scum/rules.js';

/**
 * The custom-id prefix. It must stay equal to `MAFIA_ID`, because index.ts
 * routes on that string and a drift would leave every button here silently
 * dead. mafia.ts declares `MAFIA_ID: typeof SETUP_ID`, so the drift is a build
 * error rather than something discovered in the middle of a game.
 */
export const SETUP_ID = 'mf';

const enc = (...p: (string | number)[]) => [SETUP_ID, ...p].join('|');

const C = { panel: 0x9b6cff, off: 0x4f545c } as const;

/* ── config ────────────────────────────────────────────────────── */

/**
 * `MafiaConfig` plus the one knob the spec asks for that games.ts does not
 * carry yet.
 *
 * The night story is normally told out loud — God narrates over voice, and a
 * bot posting the same deaths in text while he is mid-sentence steps on the
 * only dramatic moment the game has. So it is off unless God turns it on, and
 * the flag rides in the same jsonb blob as the rest of the config, where the
 * narration work can read it without this panel having to own games.ts.
 */
// nightStoryPublic lives on MafiaConfig itself, so there is nothing to add here
// and nothing that can drift out of step with the narration code that reads it.
export type PanelConfig = MafiaConfig;

export const PANEL_DEFAULTS: PanelConfig = MAFIA_DEFAULTS;

/**
 * Which console runs this game.
 *
 * Lives on the event's state rather than in config, because `isScum` reads it
 * there and one source is the whole point — a second copy in config would let
 * the panel and the router disagree about which game is being played.
 */
export const modeOf = (ev: EventRow): 'scum' | 'irani' =>
  (ev.state as { mode?: string }).mode === 'scum' ? 'scum' : 'irani';

/** The stored blob, untouched — including keys this panel knows nothing about. */
const rawConfig = (ev: EventRow): Record<string, unknown> =>
  (ev.state as { config?: Record<string, unknown> }).config ?? {};

/** Current settings, with defaults standing in for anything never set. */
export const panelConfig = (ev: EventRow): PanelConfig =>
  ({ ...PANEL_DEFAULTS, ...(rawConfig(ev) as Partial<PanelConfig>) });

/**
 * Writes one change and hands back the row as it now stands.
 *
 * `mergeState` merges at the top level of `state`, so `config` is replaced
 * whole — which means the write has to carry every other key with it. It is
 * rebuilt from a *fresh* read rather than from `ev`, because the panel can sit
 * open on someone's screen for an hour while the wizard, the night and God's
 * other clicks all move the same row underneath it.
 *
 * The raw blob is spread rather than `panelConfig(fresh)` so that keys outside
 * `MafiaConfig` — the wizard stores `players` there — survive a settings change.
 */
async function write(ev: EventRow, patch: Partial<PanelConfig>): Promise<EventRow> {
  const fresh = (await getEvent(ev.id)) ?? ev;
  await mergeState(ev.id, { config: { ...PANEL_DEFAULTS, ...rawConfig(fresh), ...patch } });
  return (await getEvent(ev.id)) ?? fresh;
}

/* ── the live text channel ─────────────────────────────────────── */

type TextRuleApplier = (guild: Guild, ev: EventRow, phase: Phase) => Promise<unknown>;

/**
 * mafia.ts owns `applyTextRules` and already imports this file, so it hands the
 * function in at install time instead of us importing it back and closing a
 * cycle — the same trick `setEventFinisher` plays there.
 *
 * It matters because of what "applies immediately" has to mean for a text rule:
 * changing the rule for the phase the game is *in* has to move the channel's
 * permissions now, not at the next press of Shab. Otherwise God unlocks the
 * chat, nothing happens, and he presses it four more times.
 */
let applyText: TextRuleApplier | null = null;
export const setTextRuleApplier = (fn: TextRuleApplier): void => { applyText = fn; };

/** Re-applies a phase's rule if the game is standing in that phase right now. */
async function reapply(guild: Guild | null, ev: EventRow, phase: Phase): Promise<void> {
  if (!guild || !applyText) return;
  if ((ev.state as { textPhase?: Phase }).textPhase !== phase) return;
  await applyText(guild, ev, phase).catch(() => {});
}

/* ── labels ────────────────────────────────────────────────────── */

const PHASE_FA: Record<Phase, string> = {
  day: 'Rooz', night: 'Shab', ejma: 'Ejma', defense: 'Defa', vote: 'Ray giri',
};

/** Short enough to sit four-across on one line of the hub. */
const RULE_SHORT: Record<TextRule, string> = {
  free: 'Azad', reactions: 'Reaction', emoji: '👍👎', locked: 'Baste',
};

const SIDE_EMOJI: Record<ScumRole['side'], string> = {
  shahr: '🟢', mafia: '🔴', gray: '⚪',
};

const roleList = (): ScumRole[] => Object.values(SCUM_ROLES);

const isOn = (cfg: PanelConfig, key: string): boolean => !cfg.disabledRoles.includes(key);

/** Four rows of buttons at most; the fifth belongs to the way back. */
const ROLE_ROW_BUDGET = 4;

/**
 * Role buttons, grouped by side and chunked to Discord's five-per-row.
 *
 * Grouped rather than packed because God reads this while a game waits: shahr
 * on its own lines, then mafia, then the two grays who are nobody's team.
 *
 * Thirteen roles fill 5+3, 3, 2 — exactly the budget. A fourteenth mafia role
 * would push the grays off the screen, so the overflow is handed back rather
 * than dropped: the screen says which roles it could not draw, instead of
 * quietly presenting a role list that is missing two names.
 */
function roleRows(
  cfg: PanelConfig, eventId: number,
): { rows: ActionRowBuilder<ButtonBuilder>[]; cut: ScumRole[] } {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const cut: ScumRole[] = [];

  for (const side of ['shahr', 'mafia', 'gray'] as const) {
    const group = roleList().filter(r => r.side === side);
    for (let i = 0; i < group.length; i += 5) {
      const chunk = group.slice(i, i + 5);
      if (rows.length === ROLE_ROW_BUDGET) { cut.push(...chunk); continue; }
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        chunk.map(r => new ButtonBuilder()
          .setCustomId(enc('cfgrole', eventId, r.key))
          .setLabel(isolate(r.fa))
          .setEmoji(SIDE_EMOJI[r.side])
          .setStyle(isOn(cfg, r.key) ? ButtonStyle.Success : ButtonStyle.Secondary)
          // The Don is the mafia's only night shot; a game without one has no
          // mafia turn at all. Rendered dead rather than refused on click —
          // being told "no" after pressing is a worse answer than not being
          // offered the press.
          .setDisabled(!canDisable(r.key))),
      ));
    }
  }
  return { rows, cut };
}

/* ── the hub ───────────────────────────────────────────────────── */

const backRow = (eventId: number, extra: ButtonBuilder[] = []) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('cfg', eventId, 'hub'))
      .setLabel('Bargard').setEmoji('◀️').setStyle(ButtonStyle.Secondary),
    ...extra,
  );

function hubScreen(ev: EventRow) {
  const cfg = panelConfig(ev);
  const off = roleList().filter(r => !isOn(cfg, r.key));
  const on = roleList().length - off.length;

  const box = new ContainerBuilder().setAccentColor(C.panel)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## ⚙️ Tanzimat\n-# Har chi avaz koni hamoon lahze emal mishe — vasate baazi ham eshkal nadare.'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `🎭 **Naghsh ha** — ${num(on)} roshan · ${num(off.length)} khamoosh`,
      off.length
        ? `-# Khamoosh: ${off.map(r => isolate(r.fa)).join(' · ')}`
        : '-# Hameye naghsh ha too baazian.',
      '',
      '💬 **Chat**',
      `-# ${PHASES.map(p => `${PHASE_FA[p]}: **${RULE_SHORT[cfg.textRules[p] ?? 'free']}**`).join(' · ')}`,
      '',
      `🗳️ **Ray giri** — ${cfg.voteAutoClose
        ? `khodkar, ${num(cfg.voteSeconds)} sanie`
        : 'dasti, ba dokmeye gardanande'}`,
      `🔫 **Sahmiye** — Sniper ${num(cfg.sniperBullets)} golole · `
        + `Shahrdar ${num(cfg.shahrdarVetoes)} veto · Kalantar ${num(cfg.kalantarGuns)} asleha`,
      `${modeOf(ev) === 'scum' ? '🃏' : '🎲'} **Halat** — ${modeOf(ev) === 'scum'
        ? 'Mafia Scum (mostaghim ray giri, do dor)'
        : 'Mafiaye Irani (ray giri avval -> defa -> ejma)'}`,
      `${cfg.signupGated ? '🔒' : '🌐'} **Sabt nam** — ${cfg.signupGated
        ? 'faghat kesi ke role e Mafia Player dare'
        : 'baz baraye hame'}`,
      `${cfg.nightStoryPublic ? '📖' : '🎙️'} **Naghl e shab** — ${cfg.nightStoryPublic
        ? 'too chat ham post mishe'
        : 'faghat rooye voice, khodet migi'}`,
    ].join('\n')));

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('cfg', ev.id, 'roles')).setLabel('Naghsh ha')
      .setEmoji('🎭').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(enc('cfg', ev.id, 'chat')).setLabel('Chat')
      .setEmoji('💬').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(enc('cfg', ev.id, 'vote')).setLabel('Ray giri')
      .setEmoji('🗳️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(enc('cfg', ev.id, 'budget')).setLabel('Sahmiye')
      .setEmoji('🔫').setStyle(ButtonStyle.Primary),
  ));

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('cfgmode', ev.id))
      .setLabel(modeOf(ev) === 'scum' ? 'Halat: Mafia Scum' : 'Halat: Mafiaye Irani')
      .setEmoji(modeOf(ev) === 'scum' ? '🃏' : '🎲')
      .setStyle(ButtonStyle.Primary)
      // Roles are dealt at start, and the two modes deal different casts.
      // Changing this afterwards would leave people holding roles their own
      // console has never heard of.
      .setDisabled(ev.status === 'running'),
  ));

  // The plain booleans live on the hub itself. Giving each a screen of its own
  // would be three clicks to flip one switch.
  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('cfgflag', ev.id, 'signupGated'))
      .setLabel(cfg.signupGated ? 'Sabt nam: mahdood' : 'Sabt nam: baz')
      .setEmoji(cfg.signupGated ? '🔒' : '🌐')
      .setStyle(cfg.signupGated ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('cfgflag', ev.id, 'nightStoryPublic'))
      .setLabel(cfg.nightStoryPublic ? 'Naghl e shab: too chat' : 'Naghl e shab: voice')
      .setEmoji(cfg.nightStoryPublic ? '📖' : '🎙️')
      .setStyle(cfg.nightStoryPublic ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('cfgclose', ev.id))
      .setLabel('Bastan').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  ));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

/* ── roles ─────────────────────────────────────────────────────── */

function rolesScreen(ev: EventRow) {
  const cfg = panelConfig(ev);
  const { rows, cut } = roleRows(cfg, ev.id);
  const mandatory = roleList().filter(r => !canDisable(r.key));

  const box = new ContainerBuilder().setAccentColor(C.panel)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## 🎭 Naghsh ha\n-# Bezan roo har naghsh ta roshan/khamoosh she. Baazi bedoone Saghi ham baazi e.'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      ...roleList().map(r =>
        `${isOn(cfg, r.key) ? '✅' : '⬜'} ${SIDE_EMOJI[r.side]} ${isolate(r.fa)}`
        + (canDisable(r.key) ? '' : '  🔒')),
      // `-#` only makes subtext at the start of a line, so the note about the
      // locked roles gets a line of its own rather than trailing the Don.
      `-# 🔒 ${mandatory.map(r => isolate(r.fa)).join(' · ')} hatmi e — `
        + 'bedoone oon mafia shellik e shab nadare.',
      ...(cut.length
        ? [`⚠️ Ja nashod: ${cut.map(r => isolate(r.fa)).join(' · ')} — `
           + 'dokmash roo in safhe ja nemishe.']
        : []),
    ].join('\n')));

  for (const row of rows) box.addActionRowComponents(row);
  box.addActionRowComponents(backRow(ev.id));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

/* ── chat rules ────────────────────────────────────────────────── */

const ruleSelect = (eventId: number, phase: Phase, rule: TextRule) =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('cfgtext', eventId, phase))
      .setPlaceholder(`${PHASE_FA[phase]} — ${TEXT_RULE_FA[rule]}`)
      .addOptions((Object.keys(TEXT_RULE_FA) as TextRule[]).map(r =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${PHASE_FA[phase]} · ${TEXT_RULE_FA[r]}`.slice(0, 100))
          .setValue(r)
          .setDefault(r === rule))));

/**
 * Four phases here, not five.
 *
 * Ray-giri's rule sits on the vote screen instead, beside the two other vote
 * settings — it is the same decision as the rest of that screen (the doc's
 * "during Ray-giri the channel is locked" is a vote rule that happens to be
 * spelled as a text rule), and it buys back the fifth row for the way home.
 */
function chatScreen(ev: EventRow) {
  const cfg = panelConfig(ev);
  const box = new ContainerBuilder().setAccentColor(C.panel)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## 💬 Chat\n-# Har faz, chat e baazi chi ejaze mide. Ray giri too safheye khodesh e.'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      PHASES.map(p => `**${PHASE_FA[p]}** — ${TEXT_RULE_FA[cfg.textRules[p] ?? 'free']}`).join('\n')));

  for (const p of PHASES) {
    if (p === 'vote') continue;
    box.addActionRowComponents(ruleSelect(ev.id, p, cfg.textRules[p] ?? 'free'));
  }
  box.addActionRowComponents(backRow(ev.id));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

/* ── vote ──────────────────────────────────────────────────────── */

const SECONDS = [30, 45, 60, 90, 120, 180] as const;

function voteScreen(ev: EventRow) {
  const cfg = panelConfig(ev);
  const box = new ContainerBuilder().setAccentColor(C.panel)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## 🗳️ Ray giri\n-# Ba timer khodesh baste beshe, ya montazere dokmeye to bemoone.'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      cfg.voteAutoClose
        ? `⏱ **Khodkar** — bad az ${num(cfg.voteSeconds)} sanie khodesh baste mishe.`
        : '🔒 **Dasti** — ta vaghti "Bastane ray giri" ro nazani baz mimoone.',
      `💬 **Chat mooghe ray giri** — ${TEXT_RULE_FA[cfg.textRules.vote ?? 'locked']}`,
      '-# Tossie: mooghe ray giri chat baste bashe, ta sandoogh tanha rah e ray dadan bashe.',
    ].join('\n')));

  box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('cfgnum', ev.id, 'voteSeconds'))
      .setPlaceholder(`Timer — ${cfg.voteSeconds} sanie`)
      .addOptions(SECONDS.map(n => new StringSelectMenuOptionBuilder()
        .setLabel(`${n} sanie`).setValue(String(n)).setDefault(n === cfg.voteSeconds)))));

  box.addActionRowComponents(ruleSelect(ev.id, 'vote', cfg.textRules.vote ?? 'locked'));

  box.addActionRowComponents(backRow(ev.id, [
    new ButtonBuilder().setCustomId(enc('cfgflag', ev.id, 'voteAutoClose'))
      .setLabel(cfg.voteAutoClose ? 'Baste shodan: khodkar' : 'Baste shodan: dasti')
      .setEmoji(cfg.voteAutoClose ? '⏱' : '🔒')
      .setStyle(cfg.voteAutoClose ? ButtonStyle.Success : ButtonStyle.Secondary),
  ]));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

/* ── budgets ───────────────────────────────────────────────────── */

const BUDGETS = [
  { field: 'sniperBullets',  label: 'Golole haye Sniper',  unit: 'golole', max: 6 },
  { field: 'shahrdarVetoes', label: 'Veto haye Shahrdar',  unit: 'veto',   max: 3 },
  { field: 'kalantarGuns',   label: 'Asleha haye Kalantar', unit: 'asleha', max: 5 },
] as const satisfies readonly {
  field: 'sniperBullets' | 'shahrdarVetoes' | 'kalantarGuns';
  label: string; unit: string; max: number;
}[];

type BudgetField = typeof BUDGETS[number]['field'];

function budgetScreen(ev: EventRow) {
  const cfg = panelConfig(ev);
  const box = new ContainerBuilder().setAccentColor(C.panel)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '## 🔫 Sahmiye\n-# Chand bar har naghsh mitoone ghodratesh ro too kole baazi estefade kone.'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `${isolate('اسنایپر')} — ${num(cfg.sniperBullets)} golole · shabi yeki`,
      `${isolate('شهردار')} — ${num(cfg.shahrdarVetoes)} veto rooye ray e tamoom shode`,
      `${isolate('کلانتر')} — ${num(cfg.kalantarGuns)} asleha, ke rooz shellik mishe`,
      '-# Sefr yani un ghodrat too in baazi kar nemikone.',
    ].join('\n')));

  for (const b of BUDGETS) {
    const now = cfg[b.field];
    box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(enc('cfgnum', ev.id, b.field))
        .setPlaceholder(`${b.label} — ${now}`)
        .addOptions(Array.from({ length: b.max + 1 }, (_, n) => new StringSelectMenuOptionBuilder()
          .setLabel(`${n} ${b.unit}`).setValue(String(n)).setDefault(n === now)))));
  }
  box.addActionRowComponents(backRow(ev.id));

  return { components: [box], flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };
}

/* ── routing ───────────────────────────────────────────────────── */

type Section = 'hub' | 'roles' | 'chat' | 'vote' | 'budget';

const screen = (ev: EventRow, section: Section) =>
  section === 'roles' ? rolesScreen(ev)
  : section === 'chat' ? chatScreen(ev)
  : section === 'vote' ? voteScreen(ev)
  : section === 'budget' ? budgetScreen(ev)
  : hubScreen(ev);

/** The console's way in. mafia.ts puts this on God's button row. */
export const setupButton = (eventId: number): ButtonBuilder =>
  new ButtonBuilder().setCustomId(enc('cfg', eventId, 'open'))
    .setLabel('Tanzimat').setEmoji('⚙️').setStyle(ButtonStyle.Secondary);

/** Opens the panel fresh, as an ephemeral reply only God sees. */
export async function openSetupPanel(i: ButtonInteraction, ev: EventRow): Promise<void> {
  await i.reply(hubScreen(ev));
}

const isSection = (s: string | undefined): s is Section =>
  s === 'hub' || s === 'roles' || s === 'chat' || s === 'vote' || s === 'budget';

const isTextRule = (s: string): s is TextRule => s in TEXT_RULE_FA;

const isBudget = (s: string): s is BudgetField =>
  BUDGETS.some(b => b.field === s);

/**
 * Handles every Tanzimat component, or reports that it was not one of ours.
 *
 * mafia.ts calls this *after* its own `canRun` check, so the host gate is the
 * console's — there is one rule about who may touch a running game and it lives
 * in one place.
 *
 * Every branch ends by redrawing from the row that came back from the write, so
 * what God sees next is what the database now holds.
 */
/**
 * A `cfg…` id we recognise the shape of but not the argument — a stale message
 * from before a rename, or a hand-made id. It is still ours, so it is answered
 * with the hub rather than dropped: an unanswered component leaves "This
 * interaction failed" on God's screen and no way to tell why.
 */
async function unknown(
  i: ButtonInteraction | StringSelectMenuInteraction, ev: EventRow,
): Promise<boolean> {
  await i.update(screen(ev, 'hub'));
  return true;
}

export async function setupComponent(
  i: ButtonInteraction | StringSelectMenuInteraction, ev: EventRow,
): Promise<boolean> {
  const [step, , arg] = i.customId.split('|').slice(1);

  // 'open' comes from the console, which is its own ephemeral message: the
  // panel has to be a new reply, or God's console is replaced by it and he has
  // lost the phase buttons. Every other 'cfg' press is navigation inside the
  // panel and edits the message in place.
  if (step === 'cfg' && i.isButton()) {
    if (arg === 'open') { await openSetupPanel(i, ev); return true; }
    await i.update(screen(ev, isSection(arg) ? arg : 'hub'));
    return true;
  }

  if (step === 'cfgclose' && i.isButton()) {
    await i.update({
      components: [new ContainerBuilder().setAccentColor(C.off)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '### ⚙️ Tanzimat baste shod\n-# Az console dobare bazesh kon.'))],
      flags: MessageFlags.IsComponentsV2 as number,
    });
    return true;
  }

  if (step === 'cfgmode' && i.isButton()) {
    if (ev.status === 'running') {
      await i.reply({
        content: 'Bazi shoro shode — halat ro dige nemishe avaz kard.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const mode = modeOf(ev) === 'scum' ? 'irani' : 'scum';
    await mergeState(ev.id, { mode });
    await i.update(screen((await getEvent(ev.id))!, 'hub'));
    return true;
  }

  if (step === 'cfgrole' && i.isButton() && arg) {
    // The Don's button is already rendered dead; this is the second lock, for
    // a replayed or hand-crafted custom id.
    if (!canDisable(arg)) {
      await i.reply({
        content: `${isolate(scumRoleOf(arg)?.fa ?? arg)} hatmi e — nemishe khamoosh kard.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const cfg = panelConfig(ev);
    const disabled = isOn(cfg, arg)
      ? [...cfg.disabledRoles, arg]
      : cfg.disabledRoles.filter(k => k !== arg);
    await i.update(screen(await write(ev, { disabledRoles: disabled }), 'roles'));
    return true;
  }

  if (step === 'cfgflag' && i.isButton() && arg) {
    const cfg = panelConfig(ev);
    if (arg === 'signupGated') {
      await i.update(screen(await write(ev, { signupGated: !cfg.signupGated }), 'hub'));
      return true;
    }
    if (arg === 'nightStoryPublic') {
      await i.update(screen(await write(ev, { nightStoryPublic: !cfg.nightStoryPublic }), 'hub'));
      return true;
    }
    if (arg === 'voteAutoClose') {
      await i.update(screen(await write(ev, { voteAutoClose: !cfg.voteAutoClose }), 'vote'));
      return true;
    }
    return unknown(i, ev);
  }

  if (step === 'cfgtext' && i.isStringSelectMenu() && arg) {
    const phase = PHASES.find(p => p === arg);
    const value = i.values[0];
    if (!phase || !value || !isTextRule(value)) return unknown(i, ev);

    const cfg = panelConfig(ev);
    const next = await write(ev, { textRules: { ...cfg.textRules, [phase]: value } });
    // Mid-game, the phase being edited may be the phase the room is standing
    // in. Move the channel now rather than at the next press of Shab.
    await reapply(i.guild, next, phase);
    await i.update(screen(next, phase === 'vote' ? 'vote' : 'chat'));
    return true;
  }

  if (step === 'cfgnum' && i.isStringSelectMenu() && arg) {
    const n = Number(i.values[0]);
    if (!Number.isFinite(n)) return unknown(i, ev);
    if (arg === 'voteSeconds') {
      await i.update(screen(await write(ev, { voteSeconds: n }), 'vote'));
      return true;
    }
    if (isBudget(arg)) {
      const patch: Partial<PanelConfig> =
        arg === 'sniperBullets' ? { sniperBullets: n }
        : arg === 'shahrdarVetoes' ? { shahrdarVetoes: n }
        : { kalantarGuns: n };
      await i.update(screen(await write(ev, patch), 'budget'));
      return true;
    }
    return unknown(i, ev);
  }

  return false;
}
