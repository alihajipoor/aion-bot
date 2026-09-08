// One-off gender tagging helper.
// Posts one message per untagged member with Boy / Girl / Skip buttons.
// A click assigns the role immediately and rewrites the message, so two
// taggers can never double-assign the same person.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField as P } from 'discord.js';

const BOY = 'ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', GIRL = 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•';
const CHAN = '•︱👥│𝙶𝙴𝙽𝙳𝙴𝚁-𝚃𝙰𝙶';
const TAGGERS = ['A I O N', 'Consultant', 'PowerAdmin'];   // who may click

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const boy = g.roles.cache.find(r => r.name === BOY), girl = g.roles.cache.find(r => r.name === GIRL);

  let ch = g.channels.cache.find(x => x.name === CHAN);
  if (!ch) {
    const ows = [{ id: g.roles.everyone.id, deny: ['ViewChannel'] }];
    for (const t of TAGGERS) { const r = g.roles.cache.find(x => x.name === t); if (r) ows.push({ id: r.id, allow: ['ViewChannel','ReadMessageHistory','SendMessages'] }); }
    ows.push({ id: g.members.me.id, allow: ['ViewChannel','SendMessages','ReadMessageHistory','ManageMessages'] });
    ch = await g.channels.create({ name: CHAN, type: ChannelType.GuildText, permissionOverwrites: ows, reason: 'AION: temporary gender tagging' });
    console.log('created channel', ch.name);
  }

  // Which members already have a card posted? (makes restarts safe)
  const posted = new Set();
  let before;
  for (let page = 0; page < 12; page++) {
    const batch = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    for (const msg of batch.values()) {
      const m = msg.content.match(/<@(\d+)>/);
      if (m) posted.add(m[1]);
      for (const row of msg.components ?? [])
        for (const comp of row.components ?? [])
          if (comp.customId?.startsWith('g:')) posted.add(comp.customId.split(':')[1]);
    }
    before = batch.last().id;
  }
  const members = await g.members.fetch({ time: 60000 });
  const todo = [...members.values()].filter(m => !m.user.bot && !m.roles.cache.has(boy.id) && !m.roles.cache.has(girl.id) && !posted.has(m.id));
  console.log(`${posted.size} already posted. ${todo.length} still to post.`);

  if (todo.length) await ch.send(`## 👥 Gender tagging — ${todo.length} more\nHar kas mitune click kone. Baraye har nafar **Boy** ya **Girl** ro bezan.`);

  for (const m of todo) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`g:${m.id}:boy`).setLabel('Boy').setEmoji('👦').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`g:${m.id}:girl`).setLabel('Girl').setEmoji('👧').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`g:${m.id}:skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    const label = m.nickname ? `${m.nickname}  ·  \`${m.user.tag}\`` : `\`${m.user.tag}\``;
    await ch.send({ content: `${label}  —  <@${m.id}>`, components: [row] });
    await new Promise(r => setTimeout(r, 1100));
  }
  console.log('All posted. Listening for clicks — leave this running.');
});

c.on('interactionCreate', async (i) => {
  if (!i.isButton() || !i.customId.startsWith('g:')) return;
  const [, uid, choice] = i.customId.split(':');
  const g = i.guild;
  // Open to every member: the owner asked for all-hands tagging.
  if (!i.member) return;

  try {
    const target = await g.members.fetch(uid).catch(() => null);
    if (!target) return i.update({ content: `⚠️ ${i.message.content}\n*(member left the server)*`, components: [] });
    if (choice === 'skip') return i.update({ content: `⏭️ ~~${i.message.content}~~  · skipped by ${i.user.username}`, components: [] });
    const role = g.roles.cache.find(r => r.name === (choice === 'boy' ? BOY : GIRL));
    await target.roles.add(role, `gender tag by ${i.user.tag}`);
    await i.update({ content: `${choice === 'boy' ? '👦' : '👧'} **${choice === 'boy' ? 'Boy' : 'Girl'}** — ${i.message.content}  · by ${i.user.username}`, components: [] });
  } catch (e) {
    await i.reply({ content: `Error: ${e.message}`, flags: 64 }).catch(() => {});
  }
});
c.login(process.env.DISCORD_TOKEN);
