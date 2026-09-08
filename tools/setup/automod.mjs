// Create and own Discord's native AutoMod rules from AION.
//
// AutoMod runs on Discord's side, so this costs the VPS nothing — and hits
// land in the `automod` log route the bot already has but has never fired.
// Rules are matched by name and edited in place, so re-running is safe.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  Client, GatewayIntentBits, ChannelType,
  AutoModerationRuleTriggerType as Trigger,
  AutoModerationActionType as Action,
  AutoModerationRuleEventType as EventType,
  AutoModerationRuleKeywordPresetType as Preset,
} from 'discord.js';
// Channel names are written in small caps, which no plain regex matches.
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const APPLY = process.argv.includes('--apply');
const HERE = dirname(fileURLToPath(import.meta.url));
const LISTS = join(HERE, '..', '..', 'apps', 'bot', 'assets', 'automod');

const EXEMPT_ROLES = ['Consultant', 'PowerAdmin', 'Dev', 'AION'];
const ALERT_CHANNEL = /banned-log|admin-chat/i;

/** Link shapes that carry scams. Rust regex: no lookarounds, (?i) for case. */
const SCAM_PATTERNS = [
  '(?i)(free|gift|claim)\\s*(discord\\s*)?nitro',
  '(?i)(discord|steam|nitro)[a-z0-9-]*\\.(gift|ru|xyz|top|click|link|shop)',
  '(?i)(t\\.me|telegram\\.me)/[a-z0-9_]+',
  '(?i)\\b(usdt|binance|trust ?wallet)\\b.{0,40}\\b(gift|bonus|airdrop|free)\\b',
];

async function list(file) {
  const raw = await readFile(join(LISTS, file), 'utf8');
  return raw.split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .slice(0, 1000);
}

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();
    await g.channels.fetch();

    const exemptRoles = EXEMPT_ROLES
      .map(n => g.roles.cache.find(r => r.name === n)?.id).filter(Boolean);
    const alertCh = [...g.channels.cache.values()]
      .find(x => x.type === ChannelType.GuildText && ALERT_CHANNEL.test(asciiFold(x.name)));
    if (!alertCh) console.warn('! no alert channel matched — rules will block silently');

    const alert = alertCh ? [{ type: Action.SendAlertMessage, metadata: { channel: alertCh.id } }] : [];
    const block = reason => ({ type: Action.BlockMessage, metadata: { customMessage: reason } });
    const timeout = seconds => ({ type: Action.Timeout, metadata: { durationSeconds: seconds } });

    const wanted = [
      {
        name: 'AION · Mention spam',
        eventType: EventType.MessageSend,
        triggerType: Trigger.MentionSpam,
        triggerMetadata: { mentionTotalLimit: 5, mentionRaidProtectionEnabled: true },
        actions: [block('Tedade mention ziad bood.'), ...alert],
      },
      {
        name: 'AION · Spam content',
        eventType: EventType.MessageSend,
        triggerType: Trigger.Spam,
        triggerMetadata: {},
        actions: [block('In payam spam tashkhis dade shod.'), ...alert],
      },
      {
        name: 'AION · Preset words',
        eventType: EventType.MessageSend,
        triggerType: Trigger.KeywordPreset,
        triggerMetadata: {
          presets: [Preset.Profanity, Preset.Slurs, Preset.SexualContent],
          allowList: [],
        },
        actions: [block('In kalame ejaze nadare.'), ...alert],
      },
      {
        name: 'AION · Fosh',
        eventType: EventType.MessageSend,
        triggerType: Trigger.Keyword,
        triggerMetadata: { keywordFilter: await list('fa-profanity.txt'), regexPatterns: [], allowList: [] },
        actions: [block('Fosh nade. Payamet pak shod.'), ...alert],
      },
      {
        name: 'AION · Scam',
        eventType: EventType.MessageSend,
        triggerType: Trigger.Keyword,
        triggerMetadata: {
          keywordFilter: await list('scam-phrases.txt'),
          regexPatterns: SCAM_PATTERNS,
          allowList: [],
        },
        actions: [block('Link/pishnahade mashkook pak shod.'), ...alert, timeout(300)],
      },
    ];

    const existing = await g.autoModerationRules.fetch();
    for (const rule of wanted) {
      const found = existing.find(r => r.name === rule.name);
      const payload = { ...rule, enabled: true, exemptRoles, exemptChannels: [] };
      const words = rule.triggerMetadata.keywordFilter?.length;
      const label = `${rule.name}${words ? ` (${words} words)` : ''}`;

      if (!APPLY) { console.log(`${found ? 'WOULD UPDATE' : 'WOULD CREATE'}  ${label}`); continue; }
      if (found) { await found.edit(payload); console.log(`updated  ${label}`); }
      else { await g.autoModerationRules.create(payload); console.log(`created  ${label}`); }
    }

    if (!APPLY) console.log('\ndry run — pass --apply to write');
    else console.log(`\nalerts -> #${alertCh?.name ?? '(none)'} · exempt: ${EXEMPT_ROLES.join(', ')}`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
