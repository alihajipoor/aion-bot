// Creates the two mafia channels in QUIDDITCH: the guide and the history.
//
//   node tools/setup/mafiachannels.mjs             # dry run
//   node tools/setup/mafiachannels.mjs --apply
//   node tools/setup/mafiachannels.mjs --apply --repost   # rewrite the guide text
//
// Both are read-only for members: the guide is a reference and the history is a
// record, and a channel people can chat in buries both within a day. Reactions
// stay open so neither is a dead wall. Only Consultant and above can post.
//
// Idempotent. Running it again finds the channels and re-applies the overwrites
// with set(), not edit() — the list below is the whole truth for these
// channels, so a grant somebody added by hand is removed rather than quietly
// surviving. --repost additionally clears the bot's own guide posts and writes
// them again, which is how the rules get corrected after MAFIA.md changes.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';
import { asciiFold, isolate, num } from '../../apps/bot/dist/lib/text.js';
import { SCENARIOS } from '../../apps/bot/dist/modules/events/games.js';
import { SCUM_ROLES } from '../../apps/bot/dist/modules/events/scum/rules.js';

const APPLY  = process.argv.includes('--apply');
const REPOST = process.argv.includes('--repost');

const GUIDE   = '•︱📜│𝙼𝙰𝙵𝙸𝙰-𝙶𝚄𝙸𝙳𝙴';
const HISTORY = '•︱🏆│𝙼𝙰𝙵𝙸𝙰-𝙷𝙸𝚂𝚃𝙾𝚁𝚈';
const STAFF = ['Consultant', 'Dev'];   // Consultant and above

/* ── the guide, in Persian ─────────────────────────────────────── */

// Persian digits, because a Persian rulebook with a bare 2 in it reads
// half-translated. Where an ASCII digit has to survive, num() prefixes an
// Arabic Letter Mark — the only thing that stops a Persian letter retargeting
// the digits that follow it and walking them to the wrong side of the word.
const fa = (n) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);

// Latin role names sit inside Persian sentences, so every one of them is
// isolated. Without it the bidi algorithm reorders the parenthesis around it
// and the line reads as nonsense.
const L = (s) => isolate(s);

/*
 * Role lists are generated from the code that deals them, never typed out here.
 *
 * A guide that disagrees with the game is worse than no guide: players plan
 * around it and then lose to a rule it got wrong. Add a role in games.ts or
 * rules.ts and it appears here on the next --repost; nobody has to remember.
 */
// The side reads as a note about the role, not as part of its name: "مافیا
// پدرخوانده" parses as one title and has to be untangled. Dot in front, side in
// brackets behind.
const SIDE_DOT  = { mafia: '🔴', town: '🟢', shahr: '🟢', solo: '⚪', gray: '⚪' };
const SIDE_WORD = { mafia: 'مافیا', town: 'شهر', shahr: 'شهر', solo: 'تک‌نفره', gray: 'خاکستری' };

/** One Persian-Mafia scenario, as its own complete ruleset. */
const scenarioPage = (sc) => [
  `## 🎲 مافیای ایرانی — سناریوی ${sc.fa}`,
  '',
  `تعداد بازیکن: **${fa(sc.min)} تا ${fa(sc.max)}** نفر`,
  ...(sc.blurb ? ['', `-# ${L(sc.blurb)}`] : []),
  '',
  '### ساختار روز',
  '> رای‌گیری اولیه ← دفاع ← اجماع (رای پایانی)',
  '> -# رای‌گیری اولیه فقط مشخص می‌کنه کیا دفاع کنن. حذف توی اجماع اتفاق می‌افته.',
  '',
  '### نقش‌ها',
  ...sc.roles.map(r =>
    `> ${SIDE_DOT[r.side] ?? ''} **${r.fa}**` +
    ` (${SIDE_WORD[r.side] ?? r.side}${r.optional ? ' · اختیاری' : ''})` +
    (r.blurb ? `\n>    -# ${L(r.blurb)}` : '')),
];

/** The Scum cast, grouped by side, generated from the rules engine. */
const scumRolesPage = () => {
  const all = Object.values(SCUM_ROLES);
  const group = (side, title) => [
    '', `### ${title}`,
    ...all.filter(r => r.side === side).map(r => {
      const counts = r.countsAs !== r.side
        ? `  -# در شمارش: ${SIDE_WORD[r.countsAs] ?? r.countsAs}` : '';
      return `> ${SIDE_DOT[r.side] ?? ''} **${r.fa}**${r.night ? ' 🌙' : ''}${counts}`;
    }),
  ];
  return [
    '## 🃏 مافیا اسکام — فهرست نقش‌ها',
    '',
    '🌙 یعنی این رول‌ها در شب عملکرد و قدرت دارند.',
    ...group('shahr', '🟢 شهر'),
    ...group('mafia', '🔴 مافیا'),
    ...group('gray', '⚪ خاکستری — تیم نیستن'),
    '',
    '-# جزئیات هر قدرت توی پست‌های بعدیه.',
  ];
};

const PAGES = [

  [
    '# 🕵️ راهنمای مافیای آیون',
    '',
    'اینجا قوانین خونه‌ست. هر چی اینجا نوشته شده حرف آخره —',
    'توی اینترنت هر سناریویی نقش‌ها رو یه جور تعریف کرده، ولی بازی این سرور اینه.',
    '',
    '## 🎮 حالت‌های بازی',
    '',
    `**مافیای ایرانی** — رای‌گیری اولیه ← دفاع ← اجماع (رای پایانی)`,
    `**مافیا اسکام** (${L('Mafia Scum')}) — بدون لابی، مستقیم رای‌گیری، دو دور`,
    '',
    '**رای‌گیری اولیه** مشخص می‌کنه کیا باید دفاع کنن؛ کسی اونجا حذف نمی‌شه.',
    'بعد از دفاع‌ها **اجماع** انجام می‌شه — رای پایانی، و حذف همون‌جاست.',
    '',
    `قانون اصلی ${L('Mafia Scum')} اینه که **می‌تونی وسط صحبت نقشت رو بگی**.`,
    'یه مافیا می‌تونه ادعا کنه دکتره. کل بازی همینه: اینکه به ادعای کی باور داری،',
    'نه اینکه چطوری اطلاعات بکشی بیرون.',
  ],

  [
    '## ⚪ نقش‌های خاکستری',
    '',
    'اینا **تیم نیستن**، تک‌نفره‌ان. معمولاً فقط یکیشون توی بازیه؛ هر دو فقط توی بازی‌های بزرگ.',
    '',
    '### پلیس خائن',
    '> ◆ موقع پخش نقش، ربات بهش دایرکت می‌ده: **کدوم طرفی؟**',
    '> ◆ هیچ‌وقت چت مافیا رو نمی‌بینه و هیچ‌وقت نمی‌فهمه مافیاها کی‌ان — هر طرفی که باشه.',
    '> ◆ توی شمارش رای و تعداد بازیکن **همیشه شهر** حساب می‌شه.',
    '> ◆ دقیقاً مثل شهروند ساده بازی می‌کنه.',
    '> ◆ اگه مافیا رو انتخاب کرده باشه و مافیا ببره، به عنوان برنده اعلام می‌شه',
    '>    و امتیازش توی تیم مافیا ثبت می‌شه.',
    '> ◆ کاراگاه اون رو **شهر** می‌خونه.',
    '',
    '### ناتاشا',
    '> ◆ همیشه تیم مافیاست، ولی چت مافیا رو نمی‌بینه و تیمش رو نمی‌شناسه.',
    '> ◆ توی شمارش رای و تعداد بازیکن **مافیا** حساب می‌شه.',
    '> ◆ شب: یه نفر رو ساکت می‌کنه. اون نفر روز بعد **نه حرف می‌زنه، نه رای می‌ده**.',
    '> ◆ **دو شب پشت سر هم** نمی‌تونه یه نفر رو ساکت کنه — ولی یه شب در میون می‌تونه.',
    '> ◆ کاراگاه اون رو **مافیا** می‌خونه.',
  ],

  [
    '## 🟢 نقش‌های شهر',
    '',
    `**اسنایپر** (${L('Sniper')}) — شب شلیک می‌کنه. تعداد کل تیرها رو گرداننده تعیین می‌کنه؛ **شبی حداکثر یه تیر**.`,
    '',
    '**رویین‌تن** — با هیچ شلیکی کشته نمی‌شه. فقط با رای، با گرداننده، یا با تروریست حذف می‌شه.',
    '',
    '**ساقی** — شب یه نفر رو مست می‌کنه؛ اون شب قدرت اون نفر کار نمی‌کنه.',
    '',
    '**شهردار** — می‌تونه یه رای‌گیری تموم‌شده رو **باطل** کنه. تعداد دفعاتش رو گرداننده تعیین می‌کنه.',
    '',
    '**کلانتر** — شب به یه نفر دیگه تفنگ می‌ده. خودش هیچ‌وقت شلیک نمی‌کنه.',
    '',
    '**دکتر** — شبی یه نفر رو نجات می‌ده، خودش هم می‌تونه باشه. بدون محدودیت.',
    '',
    '**کاراگاه** — شبی از **طرفِ** یه نفر می‌پرسه: «مافیا» یا «شهر». هیچ‌وقت خود نقش رو نمی‌فهمه.',
    '',
    '**شهروند ساده** — هیچ قدرتی نداره.',
  ],

  [
    '## 🔴 نقش‌های مافیا',
    '',
    '**مافیای ساده** — هیچ قدرتی نداره.',
    '',
    `**تروریست** (${L('Terrorist')}) — اگه **فقط با رای** حذف بشه، یه نفر رو با خودش می‌بره.`,
    '',
    '**دُن** — شبی به یه نفر شلیک می‌کنه. کاراگاه اون رو **شهر** می‌خونه.',
    '',
    '## 🌙 ترتیب شب',
    '',
    'ترتیب تزئینی نیست — با ترتیب فرق، آدم‌های زنده‌ی متفاوتی از شب بیرون میان.',
    '',
    `${num(1)}. **ساقی** اول حل می‌شه. اون شب قدرت هدفش کار نمی‌کنه.`,
    `${num(2)}. **کلانتر** تفنگ رو تحویل می‌ده (تا شلیک نشه اثری نداره).`,
    `${num(3)}. **دکتر** نجاتش رو ثبت می‌کنه.`,
    `${num(4)}. **شلیک‌ها** حل می‌شن: اول دُن، بعد اسنایپر.`,
    `${num(5)}. جواب **کاراگاه** حساب می‌شه.`,
    `${num(6)}. سکوتِ **ناتاشا** اعمال می‌شه.`,
  ],

  [
    '## 🍷 مستی',
    '',
    'هدفِ ساقی اون شب قدرتش رو از دست می‌ده، هر قدرتی که باشه:',
    '',
    '> ◆ دکتر مست → نجات انجام نمی‌شه.',
    '> ◆ دُن یا اسنایپر مست → شلیک در نمی‌ره (تیر هم **خرج نمی‌شه**).',
    '> ◆ **رویین‌تن مست → مصونیتش از بین می‌ره؛ اون شب با شلیک می‌میره.**',
    '> ◆ کاراگاه مست → جواب **برعکس** برمی‌گرده.',
    '> ◆ ناتاشا مست → کسی ساکت نمی‌شه، ولی اون هدف **سوخته** حساب می‌شه.',
    '> ◆ کلانتر مست → تفنگ تحویل داده نمی‌شه.',
    '',
    '## 🔍 استعلام کاراگاه',
    '',
    'کاراگاه **طرف** رو می‌فهمه، نه نقش رو.',
    '',
    '> ◆ **دُن** → همیشه «شهر» (همیشه برعکس)',
    '> ◆ **ناتاشا** → مافیا',
    '> ◆ **پلیس خائن** → شهر، هر طرفی که انتخاب کرده باشه',
    '> ◆ **بقیه** → طرف واقعیشون',
    '',
    'اگه کاراگاه مست باشه، جواب بالا **دوباره برعکس** می‌شه.',
    'استعلامِ دُن توی شب‌های بعدی و هوشیار هم باز «شهر» می‌ده — پوششِ دُن دائمیه، یه بار خطا زدن نیست.',
  ],

  [
    '## 🔫 تفنگ‌ها',
    '',
    '> ◆ **اسنایپر** شب شلیک می‌کنه، شبی یکی، از یه تعداد مشخص.',
    '> ◆ **دُن** شب شلیک می‌کنه، شبی یکی.',
    '> ◆ **تفنگ کلانتر** رو کسی که گرفتتش **توی روز** شلیک می‌کنه —',
    '>    از فردای روزی که گرفته به بعد. **نقش اون کسی که می‌خوره همون لحظه**',
    '>    **و جلوی همه اعلام می‌شه** — تنها مرگ توی کل بازی که نقش رو لو می‌ده.',
    '>    ممکنه دستِ خود مافیا باشه؛ ریسکش همینه.',
    '> ◆ **رویین‌تن** به هر سه تا مصونه — شلیک شلیکه.',
    '> ◆ شلیک به یه نفر از شهر **اون نفر رو می‌کشه**. اسنایپر تنبیه نمی‌شه؛',
    '>    فقط یه تیر سوخته و یه هم‌تیمی مرده.',
    '> ◆ نجاتِ دکتر **همه‌ی** شلیک‌های اون شب روی اون نفر رو می‌گیره، نه فقط اولی.',
    '',
    '## 💣 تروریست',
    '',
    '**فقط** با حذف شدن با رای فعال می‌شه. نه با هیچ شلیکی، نه با حذفِ گرداننده.',
    'هدفش رو همون لحظه انتخاب می‌کنه و قبل از شروع فاز بعدی حل می‌شه.',
  ],

  [
    '## ☀️ ساختار روز',
    '',
    `${num(1)}. **روز اول مستقیم می‌ره سر رای‌گیری.** نه لابی، نه چالش.`,
    `${num(2)}. همه به نوبت صحبت می‌کنن.`,
    `${num(3)}. **رای دور اول.** تا وقتی گرداننده فاز رو نبسته، تعداد رای‌ها از همه مخفیه.`,
    `${num(4)}. بعد از باز شدن: هر کی **${fa(2)} رای یا بیشتر** داشته باشه می‌ره دور دوم.`,
    `${num(5)}. هر کدومشون یه نوبت دفاع می‌گیره.`,
    `${num(6)}. **رای دور دوم**، بازم تا بسته شدن فاز مخفی.`,
    `${num(7)}. بیشترین رای حذف می‌شه. **مساوی یعنی هیچ‌کس حذف نمی‌شه** —`,
    '   شب با همه‌ی آدم‌های زنده شروع می‌شه.',
    `${num(8)}. نقش کسی که حذف شده **رو نمی‌شه** — تنها استثنا تفنگ کلانتره.`,
    '',
    'گرداننده هر وقت بخواد می‌تونه به هر فازی بپره: لابی، چالش، دفاع، رای‌گیری.',
  ],

  [
    '## 🏁 برد و باخت',
    '',
    '**ربات هیچ‌وقت خودش بازی رو تموم نمی‌کنه.** فقط شمارش رو نگه می‌داره و روی',
    'کنسول نشون می‌ده؛ دکمه‌ی برد رو گرداننده می‌زنه.',
    '',
    'این تصمیم عمدیه: ناتاشا مافیا حساب می‌شه بدون اینکه تو تیم مافیا باشه، و',
    'پلیس خائن شهر حساب می‌شه در حالی که ممکنه با مافیا ببره. پس یه چک خودکار',
    'حالت‌های لبه‌ای داره — و یه حالت لبه‌ای که وسط بازی فعال بشه، بازی رو برای',
    'همه خراب می‌کنه. آدم کندتر تصمیم می‌گیره، ولی یه جوری که کسی ندیده باشه اشتباه نمی‌کنه.',
    '',
    '## 🎭 رول بازیکن مافیا',
    '',
    'رول **ᴍᴀꜰɪᴀ│𝙿𝙻𝙰𝚈𝙴𝚁│•** هیچ دسترسی‌ای نمی‌ده. فقط برای اینه که موقع',
    'شروع بازی و موقع اعلام نتیجه، **فقط شما** پینگ بشید — نه کل سرور.',
    '',
    'نتیجه‌ی هر بازی تموم‌شده با ترکیب کامل نقش‌ها و بهترین بازیکن،',
    'توی کانال تاریخچه ثبت می‌شه.',
  ],
];

// Persian Mafia gets a full ruleset per scenario, then the Scum cast — inserted
// after the opening page so each mode's rules sit together rather than
// interleaved.
PAGES.splice(1, 0, ...SCENARIOS.map(scenarioPage), scumRolesPage());


/* ── the tool ──────────────────────────────────────────────────── */

const c = new Client({ intents: [GatewayIntentBits.Guilds] });

c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();
    const chans = await g.channels.fetch();

    const cat = [...chans.values()].find(x =>
      x?.type === ChannelType.GuildCategory && /quidditch/i.test(asciiFold(x.name)));
    if (!cat) { console.error('QUIDDITCH category not found'); return c.destroy(); }

    // @everyone carries the view grant and no send grant. The bot is listed
    // explicitly because set() below is authoritative: without its own row the
    // @everyone deny would apply to the bot too, and the history channel would
    // be a channel the bot cannot post its cards into.
    const staffRoles = STAFF
      .map(n => g.roles.cache.find(r => foldRole(r.name) === foldRole(n)))
      .filter(Boolean);
    for (const n of STAFF) {
      if (!staffRoles.some(r => foldRole(r.name) === foldRole(n))) console.warn(`! role not found: ${n}`);
    }

    // These channels live in QUIDDITCH, so they carry that section's sanctions.
    //
    // They have to be in THIS list rather than left to sanctionperms.mjs,
    // because set() below is authoritative: running this tool after that one
    // would silently strip the ban and the mute back off again, and a banned
    // member would quietly regain a channel nobody thought to re-check. Listing
    // them here makes the two tools agree whichever order they are run in.
    const sanction = (name, perms) => {
      const r = g.roles.cache.find(x => foldRole(x.name) === foldRole(name));
      if (!r) { console.warn(`! sanction role not found: ${name}`); return []; }
      return [{ id: r.id, deny: perms }];
    };

    const overwrites = [
      { id: g.roles.everyone.id,
        allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions],
        deny:  [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] },
      { id: g.members.me.id,
        allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages,
                P.ManageMessages, P.EmbedLinks, P.AttachFiles] },
      ...staffRoles.map(r => ({ id: r.id, allow: [P.SendMessages, P.ManageMessages] })),
      // A section ban removes the section from view entirely.
      ...sanction('Event Banned',        [P.ViewChannel]),
      ...sanction('Server Banned',       [P.ViewChannel]),
      // A mute leaves them watching, unable to contribute — reactions included,
      // or a muted member still argues in 👍 and 👎 under the rules post.
      ...sanction('Entertainment Muted', [P.SendMessages, P.AddReactions, P.SendMessagesInThreads]),
    ];

    const SPECS = [
      { name: GUIDE,   match: /mafia-?guide/,   topic: 'Ghavanin-e mafia — naghsh-ha, shab, rooz' },
      { name: HISTORY, match: /mafia-?history/, topic: 'Natije-ye har bazi — barande, tarkib, MVP' },
    ];

    const made = {};
    for (const spec of SPECS) {
      // Folded match, not a raw string compare: Discord lowercases channel
      // names and the font glyphs survive, so the stored name never equals the
      // constant above exactly.
      const existing = [...chans.values()].find(x =>
        x?.type === ChannelType.GuildText && spec.match.test(asciiFold(x.name)));

      if (existing) {
        console.log(`keep  ${existing.name}  (${existing.id})`);
        made[spec.name] = existing;
        if (APPLY) {
          // set(), not edit(): this list is the whole truth for the channel.
          await existing.permissionOverwrites.set(overwrites, 'AION: mafia channels');
          console.log(`      overwrites re-applied — writable by ${STAFF.join(', ')} ✅`);
        }
        continue;
      }

      console.log(`${APPLY ? 'MAKE ' : 'plan '} ${spec.name}  in  ${cat.name}`);
      console.log('       @everyone: read + react, no sending');
      console.log(`       writable by: ${STAFF.join(', ')}`);
      if (!APPLY) continue;

      made[spec.name] = await g.channels.create({
        name: spec.name, type: ChannelType.GuildText, parent: cat.id,
        topic: spec.topic, permissionOverwrites: overwrites,
        reason: 'AION: mafia channels',
      });
      console.log(`       made ${made[spec.name].id} ✅`);
    }

    if (!APPLY) {
      console.log(`\nguide text: ${PAGES.length} posts, ` +
        `${PAGES.reduce((n, p) => n + p.join('\n').length, 0)} characters`);
      console.log('dry run — pass --apply to create');
      return c.destroy();
    }

    /* The guide text. Written only when the channel is new, or on --repost:
       reposting every run would push the rules to the bottom of a channel
       nobody else writes in, for no change. */
    const guide = made[GUIDE];
    if (guide) {
      const fresh = await guide.messages.fetch({ limit: 50 }).catch(() => null);
      const mine = fresh ? [...fresh.values()].filter(m => m.author.id === c.user.id) : [];

      if (mine.length && !REPOST) {
        console.log(`\nguide already has ${mine.length} posts — pass --repost to rewrite them`);
      } else {
        for (const m of mine) await m.delete().catch(() => {});
        for (const page of PAGES) {
          const body = page.join('\n');
          if (body.length > 2000) { console.warn(`! a guide page is ${body.length} chars — Discord caps at 2000`); }
          // parse: [] — the guide names roles in its text and must never ping.
          await guide.send({ content: body.slice(0, 2000), allowedMentions: { parse: [] } });
        }
        console.log(`\nguide written — ${PAGES.length} posts ✅`);
      }
    }

    console.log('\nnext:  node tools/setup/mafiaroles.mjs --apply');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});

c.login(process.env.DISCORD_TOKEN);
