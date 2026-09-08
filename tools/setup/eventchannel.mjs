// Creates the staff-only EVENT-INTERFACE channel in QUIDDITCH.
// The bot posts and maintains the panel inside it on its own.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const APPLY = process.argv.includes('--apply');
const NAME = '•︱🎛│𝙴𝚅𝙴𝙽𝚃-𝙸𝙽𝚃𝙴𝚁𝙵𝙰𝙲𝙴';
const STAFF = ['Consultant', 'PowerAdmin', 'Dev', 'E . Global', 'E . MODERATOR'];

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch(); await g.channels.fetch();

    if (g.channels.cache.some(x => /event-interface/i.test(asciiFold(x.name)))) {
      console.log('event interface channel already exists');
      return c.destroy();
    }
    const cat = [...g.channels.cache.values()]
      .find(x => x.type === ChannelType.GuildCategory && /quidditch/i.test(asciiFold(x.name)));
    if (!cat) { console.log('QUIDDITCH category not found'); return c.destroy(); }

    const ows = [
      { id: g.roles.everyone.id, deny: ['ViewChannel'] },
      { id: g.members.me.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages', 'EmbedLinks', 'AttachFiles'] },
    ];
    for (const n of STAFF) {
      const r = g.roles.cache.find(x => x.name === n);
      if (r) ows.push({ id: r.id, allow: ['ViewChannel', 'ReadMessageHistory', 'SendMessages'] });
      else console.warn(`! role not found: ${n}`);
    }

    console.log(`${APPLY ? 'CREATE' : 'WOULD CREATE'} ${NAME} in ${cat.name} for ${STAFF.join(', ')}`);
    if (APPLY) {
      const ch = await g.channels.create({
        name: NAME, type: ChannelType.GuildText, parent: cat.id, position: 0,
        topic: 'Event ha ro az inja besaz, elan kon va tamoom kon',
        permissionOverwrites: ows, reason: 'AION: event interface',
      });
      console.log('created', ch.id, '— restart the bot or wait for the next ready to see the panel');
    }
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
