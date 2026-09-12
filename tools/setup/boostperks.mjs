// Turns on what the boost tier actually pays for.
//
//   tier 1   invite splash
//   tier 2   server banner, 256 kbps voice
//
// The art is rendered by the same engine as every other banner, so the server
// header, the invite background and the channel panels are one family.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { renderServerArt } from '../../apps/bot/dist/lib/banner.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const APPLY = process.argv.includes('--apply');
const TAGLINE = process.env.BANNER_TAGLINE ?? 'PERSIAN COMMUNITY';

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.channels.fetch();
    const tier = g.premiumTier;
    console.log(`boost tier ${tier} · ${g.premiumSubscriptionCount} boost(s)\n`);

    if (g.features.includes('BANNER')) {
      console.log(`${APPLY ? 'SET ' : 'plan'}  server banner 960x540${g.banner ? ' (replacing existing)' : ''}`);
      if (APPLY) {
        const art = await renderServerArt(960, 540, TAGLINE);
        if (art) await g.setBanner(art, 'AION: house identity');
      }
    } else console.log('skip  server banner — tier too low');

    if (g.features.includes('INVITE_SPLASH')) {
      console.log(`${APPLY ? 'SET ' : 'plan'}  invite splash 1920x1080${g.splash ? ' (replacing existing)' : ''}`);
      if (APPLY) {
        const art = await renderServerArt(1920, 1080, TAGLINE);
        if (art) await g.setSplash(art, 'AION: house identity');
      }
    } else console.log('skip  invite splash — tier too low');

    // Voice quality is the perk people actually hear.
    const cap = g.features.includes('AUDIO_BITRATE_256_KBPS') ? 256_000
      : g.features.includes('AUDIO_BITRATE_128_KBPS') ? 128_000 : 96_000;
    const voice = [...g.channels.cache.values()]
      .filter(x => x.type === ChannelType.GuildVoice && x.bitrate < cap);
    console.log(`\n${APPLY ? 'SET ' : 'plan'}  ${voice.length} voice channel(s) -> ${cap / 1000} kbps`);
    for (const v of voice) {
      if (!APPLY) { console.log(`        ${asciiFold(v.name).slice(0, 26).padEnd(28)} ${v.bitrate / 1000} -> ${cap / 1000}`); continue; }
      await v.setBitrate(cap, 'AION: boost tier allows it')
        .catch(e => console.error(`  ${asciiFold(v.name)}: ${e.message}`));
    }

    if (!APPLY) console.log('\ndry run — pass --apply to write');
    else console.log('done');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
