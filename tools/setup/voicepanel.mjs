// Refresh the temp-voice interface panel in place, so members do not get a
// second copy and the channel keeps exactly one control surface.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { interfacePanel } from '../../apps/bot/dist/modules/tempvoice.js';

const APPLY = process.argv.includes('--apply');
const RE = /𝙸𝙽𝚃𝙴𝚁𝙵𝙰𝙲𝙴|interface/i;

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.channels.fetch();
    const ch = [...g.channels.cache.values()].find(x => x.type === ChannelType.GuildText && RE.test(x.name));
    if (!ch) { console.log('interface channel not found'); return c.destroy(); }

    const msgs = await ch.messages.fetch({ limit: 50 });
    const mine = msgs.filter(m => m.author.id === c.user.id && m.components.length).first();
    const payload = await interfacePanel();

    if (!APPLY) {
      console.log(`${mine ? 'WOULD EDIT' : 'WOULD POST'} panel in #${ch.name}${mine ? ` (${mine.id})` : ''}`);
      return c.destroy();
    }
    if (mine) {
      await mine.edit({ ...payload, attachments: [] });
      console.log('edited', mine.id);
    } else {
      const m = await ch.send(payload);
      console.log('posted', m.id);
    }
  } catch (e) { console.error(e); }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
