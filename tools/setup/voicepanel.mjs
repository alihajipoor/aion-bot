// Refresh the temp-voice interface panel in place, so members do not get a
// second copy and the channel keeps exactly one control surface.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';
import { interfacePanel } from '../../apps/bot/dist/modules/tempvoice.js';

const APPLY = process.argv.includes('--apply');
// Both the temp voice and event panels live in a channel called INTERFACE,
// so this has to exclude the other one explicitly.
const RE = /interface/i;
const NOT = /event-interface/i;

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.channels.fetch();
    const ch = [...g.channels.cache.values()].find(x =>
      x.type === ChannelType.GuildText && RE.test(asciiFold(x.name)) && !NOT.test(asciiFold(x.name)));
    if (!ch) { console.log('interface channel not found'); return c.destroy(); }

    const msgs = await ch.messages.fetch({ limit: 50 });
    const mine = msgs.filter(m => m.author.id === c.user.id && m.components.length).first();
    const payload = await interfacePanel();

    if (!APPLY) {
      console.log(`${mine ? 'WOULD EDIT' : 'WOULD POST'} panel in #${ch.name}${mine ? ` (${mine.id})` : ''}`);
      return c.destroy();
    }
    // Edited in place so the message id survives. `attachments: []` clears the
    // previous upload and `files` supplies the new one; the empty
    // `message.attachments` you see afterwards is how Components V2 reports a
    // file owned by a component, not a failure.
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
