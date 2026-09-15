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
const SCORE   = '•︱📊│𝙼𝙰𝙵𝙸𝙰-𝚂𝙲𝙾𝚁𝙴';
const HISTORY = '•︱🏆│𝙼𝙰𝙵𝙸𝙰-𝙷𝙸𝚂𝚃𝙾𝚁𝚈';
const STAFF = ['Consultant', 'Dev'];
// Verified members. QUIDDITCH grants sight through these, never through
// @everyone — which is exactly what these channels got wrong.
const MEMBERS = ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];   // Consultant and above

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
    'قوانین این سرور همینه که اینجا نوشته شده. توی اینترنت هر سناریویی نقش‌ها رو',
    'یه جور تعریف کرده؛ ملاک ما اینه.',
    '',
    '## 🎮 حالت‌های بازی',
    '',
    '**مافیای ایرانی** — رای‌گیری اولیه ← دفاع ← اجماع',
    `**مافیا اسکام** (${L('Mafia Scum')}) — بدون لابی، مستقیم رای‌گیری، دو دور`,
    '',
    'توی هر دو حالت، **رای‌گیری اولیه** فقط مشخص می‌کنه کی باید دفاع کنه.',
    'کسی اونجا حذف نمی‌شه. حذف توی **رای پایانی** اتفاق می‌افته.',
    '',
    `## 🃏 فرق اصلی ${L('Mafia Scum')}`,
    '',
    '**می‌تونی وسط صحبتت نقشت رو بگی.** مافیا هم می‌تونه ادعا کنه دکتره.',
    'کل بازی سر همینه: به ادعای کی باور می‌کنی.',
  ],

  [
    '## ⚪ نقش‌های خاکستری',
    '',
    'اینا تیم نیستن، تک‌نفره‌ان. معمولاً یکیشون توی بازیه؛ هر دوشون فقط توی بازی‌های پرجمعیت.',
    '',
    '### پلیس خائن',
    '> اول بازی ربات بهش دایرکت می‌ده و می‌پرسه با کدوم تیم بازی می‌کنی.',
    '> هر طرفی رو که انتخاب کنه، **چت مافیا رو نمی‌بینه و مافیاها رو نمی‌شناسه**.',
    '> توی شمارش، شهر حساب می‌شه. کاراگاه هم استعلامش شهر درمیاد.',
    '> مثل شهروند ساده بازی می‌کنه.',
    '> اگه مافیا رو انتخاب کرده باشه و مافیا ببره، اونم برنده‌ست.',
    '',
    '### ناتاشا',
    '> تیمش مافیاست، ولی **چت مافیا رو نمی‌بینه و تیمش رو نمی‌شناسه**.',
    '> توی شمارش، مافیا حساب می‌شه. کاراگاه هم استعلامش مافیا درمیاد.',
    '> هر شب یه نفر رو ساکت می‌کنه: اون نفر فردا **نه حرف می‌زنه، نه رای می‌ده**.',
    '> **دو شب پشت سر هم نمی‌تونه یه نفر رو بزنه** — ولی یه شب در میون می‌تونه.',
  ],

  [
    '## 🟢 نقش‌های شهر',
    '',
    '**کاراگاه** — هر شب یه نفر رو **استعلام** می‌کنه. بهش می‌گن مافیاست یا شهر.',
    '-# نقش طرف رو نمی‌فهمه، فقط تیمش رو.',
    '',
    '**دکتر** — هر شب یه نفر رو **سیو** می‌کنه. خودش رو هم می‌تونه، هر شب که بخواد.',
    '',
    `**اسنایپر** (${L('Sniper')}) — شب شلیک می‌کنه. شبی یه تیر، و تعداد کل تیرهاش با گرداننده‌ست.`,
    '-# می‌تونه یه شب شلیک نکنه و تیرش رو نگه داره.',
    '',
    '**رویین‌تن** — **با شلیک نمی‌میره.** فقط با رای، با تروریست، یا با دستور گرداننده می‌ره.',
    '',
    '**ساقی** — هر شب یه نفر رو **مست** می‌کنه. اون نفر اون شب قدرتش کار نمی‌کنه.',
    '',
    '**شهردار** — بعد از رای پایانی می‌تونه **وتو** کنه.',
    '-# وتو یعنی کسی که رای آورده نمی‌ره، و شهردار خودش یکی دیگه رو می‌فرسته بیرون. حتماً یه نفر می‌ره.',
    '',
    '**کلانتر** — شب به یکی دیگه **تفنگ می‌ده**. خودش هیچ‌وقت شلیک نمی‌کنه.',
    '-# می‌تونه یه شب تفنگ نده و نگهش داره.',
    '',
    '**شهروند ساده** — قدرتی نداره.',
  ],

  [
    '## 🔴 نقش‌های مافیا',
    '',
    '**دُن** — هر شب به یه نفر شلیک می‌کنه.',
    '-# استعلامش **شهر** درمیاد — ولی فقط بار اول.',
    '-# اگه کاراگاه **شب بعدش دوباره** همون رو استعلام کنه، این بار جواب واقعی می‌گیره: مافیا.',
    '',
    `**تروریست** (${L('Terrorist')}) — اگه **با رای** بیرون بره، یه نفر رو با خودش می‌بره.`,
    '-# فقط با رای. با شلیک یا با دستور گرداننده این اتفاق نمی‌افته.',
    '',
    '**مافیای ساده** — قدرتی نداره.',
    '',
    '## 🌙 ترتیب شب',
    '',
    'ترتیب مهمه — با ترتیب دیگه، آدم‌های دیگه‌ای صبح زنده‌ان.',
    '',
    `${num(1)}. **ساقی** — هدفش اون شب قدرتش کار نمی‌کنه.`,
    `${num(2)}. **کلانتر** — تفنگ رو می‌ده (تا شلیک نشه اتفاقی نمی‌افته).`,
    `${num(3)}. **دکتر** — سیو ثبت می‌شه.`,
    `${num(4)}. **شلیک‌ها** — اول دُن، بعد اسنایپر.`,
    `${num(5)}. **کاراگاه** — جواب استعلام حساب می‌شه.`,
    `${num(6)}. **ناتاشا** — سکوت اعمال می‌شه.`,
  ],

  [
    '## 🍷 مستی',
    '',
    'هر کی ساقی مستش کنه، اون شب قدرتش کار نمی‌کنه:',
    '',
    '> **دکتر** — سیو انجام نمی‌شه.',
    '> **دُن یا اسنایپر** — شلیک می‌کنه ولی تیر خطا می‌ره. کسی نمی‌میره و **تیر هم سوخت**.',
    '> **رویین‌تن** — **مصونیتش می‌پره**؛ اون شب با شلیک می‌میره.',
    '> **کاراگاه** — جواب استعلام **برعکس** بهش می‌رسه.',
    '> **ناتاشا** — تلاشش شکست می‌خوره و کسی ساکت نمی‌شه، **ولی اون هدف می‌سوزه**:',
    '>    فردا شب هم نمی‌تونه سراغ همون نفر بره.',
    '> **کلانتر** — تفنگی که می‌ده **الکیه**. خودش خبر نداره، گیرنده هم خبر نداره.',
    '',
    '## 🔍 استعلام',
    '',
    'کاراگاه فقط **تیم** رو می‌فهمه، نه نقش رو.',
    '',
    '> **دُن** → بار اول شهر؛ شب بعد اگه دوباره همون رو بزنی، مافیا',
    '> **ناتاشا** → مافیا',
    '> **پلیس خائن** → شهر (هر طرفی که انتخاب کرده باشه)',
    '> **بقیه** → تیم واقعیشون',
    '',
    'اگه کاراگاه خودش مست باشه، همین جواب‌ها **برعکس** بهش می‌رسه.',
    '-# پس کاراگاهِ مست که بار اول دُن رو بزنه، جواب درست می‌گیره: دو تا دروغ همدیگه رو خنثی می‌کنن.',
    '',
    '-# اگه وسطش یکی دیگه رو استعلام کنی، پوشش دُن برمی‌گرده — باید **پشت سر هم** باشه.',
  ],

  [
    '## 🔫 تفنگ‌ها',
    '',
    '**شلیک شبانه** — دُن و اسنایپر. شبی یه تیر هر کدوم.',
    '',
    '**تفنگ کلانتر** — کلانتر شب تفنگ رو می‌ده، ولی **شلیکش توی روزه**.',
    'گیرنده صبح خبردار می‌شه و از همون روز می‌تونه شلیک کنه.',
    '',
    '> **هر موقع از روز** می‌تونه شلیک کنه — حتی وسط دفاعیه‌ی یکی دیگه.',
    '>    مایکش رو باز می‌کنه، می‌گه می‌خوام فلانی رو بزنم، و می‌زنه.',
    '> **اجماع** (رای پایانی) که شروع شد، دیگه نمی‌تونه.',
    '> کسی که می‌خوره، **نقشش همون‌جا جلوی همه لو می‌ره** — تنها مرگی که نقش رو نشون می‌ده.',
    '> ممکنه تفنگ دست خود مافیا بیفته؛ ریسکش همینه.',
    '',
    '**شلیک به شهر** — هر کی بخوره می‌میره، حتی اگه شهر باشه.',
    '-# شلیک‌کننده تنبیه نمی‌شه؛ فقط یه تیر سوخته و یه هم‌تیمی از دست رفته.',
    '',
    '**سیو دکتر** همه‌ی شلیک‌های اون شب روی اون نفر رو می‌گیره، نه فقط اولی.',
    '',
    '**رویین‌تن** به هیچ شلیکی نمی‌خوره — مگه اون شب مست شده باشه.',
  ],

  [
    '## ☀️ ساختار روز',
    '',
    `${num(1)}. **روز اول مستقیم می‌ره سر رای‌گیری.** لابی و چالش نداریم.`,
    `${num(2)}. همه به نوبت صحبت می‌کنن.`,
    `${num(3)}. **رای‌گیری اولیه** — تا گرداننده نبنده، هیچ‌کس تعداد رای‌ها رو نمی‌بینه.`,
    `${num(4)}. بعد از بسته شدن: هر کی **${fa(2)} رای یا بیشتر** آورده می‌ره روی میز.`,
    `${num(5)}. هر کدوم یه نوبت **دفاع** می‌گیرن.`,
    `${num(6)}. **اجماع** (رای پایانی) — بازم تا بسته شدن مخفیه.`,
    `${num(7)}. گرداننده که بست، معلوم می‌شه **کی به کی رای داده** و کی می‌ره.`,
    `${num(8)}. اگه شهردار زنده باشه و وتو داشته باشه، حالا تصمیم می‌گیره.`,
    `${num(9)}. **مساوی یعنی هیچ‌کس نمی‌ره.** شب با همه شروع می‌شه.`,
    '',
    '**نقش کسی که حذف می‌شه رو نمی‌شه** — تنها استثنا تفنگ کلانتره.',
    '',
    'گرداننده هر وقت بخواد می‌تونه فاز رو عوض کنه یا رد کنه.',
  ],

  [
    '## 🏁 برد و باخت',
    '',
    '**ربات خودش بازی رو تموم نمی‌کنه.** فقط شمارش رو نشون می‌ده؛ دکمه‌ی برد با گرداننده‌ست.',
    '',
    'دلیلش اینه که ناتاشا مافیا حساب می‌شه بدون اینکه توی تیم مافیا باشه، و پلیس خائن',
    'شهر حساب می‌شه در حالی که ممکنه با مافیا ببره. یه چک خودکار روی این دو تا نقش',
    'حالت‌های عجیب پیدا می‌کنه، و یه اشتباه وسط بازی، بازی رو برای همه خراب می‌کنه.',
    '',
    '## 🎭 رول بازیکن مافیا',
    '',
    'رول **ᴍᴀꜰɪᴀ│𝙿𝙻𝙰𝚈𝙴𝚁│•** هیچ دسترسی‌ای بهت نمی‌ده.',
    'فقط برای اینه که موقع شروع بازی و اعلام نتیجه **شما** پینگ بشید، نه کل سرور.',
    '',
    'نتیجه‌ی هر بازی با ترکیب کامل نقش‌ها و بهترین بازیکن، توی کانال تاریخچه ثبت می‌شه.',
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

    /*
     * Sight comes from the member roles, not from @everyone.
     *
     * These sit in QUIDDITCH, which is gated behind verification, and every
     * other channel there grants ViewChannel to the member roles and leaves
     * @everyone without it. Copying the giveaway channel's shape — where
     * @everyone *is* given sight on purpose, because people are invited to read
     * it before they join — handed the whole category's contents to anyone who
     * had not verified yet.
     */
    const memberRoles = MEMBERS
      .map(n => g.roles.cache.find(r => foldRole(r.name) === foldRole(n)))
      .filter(Boolean);
    for (const n of MEMBERS) {
      if (!memberRoles.some(r => foldRole(r.name) === foldRole(n))) console.warn(`! member role not found: ${n}`);
    }

    const overwrites = [
      // No ViewChannel here: unverified accounts hold only @everyone.
      { id: g.roles.everyone.id,
        deny:  [P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] },
      ...memberRoles.map(r => ({
        id: r.id, allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions],
      })),
      { id: g.members.me.id,
        allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages,
                P.ManageMessages, P.EmbedLinks, P.AttachFiles] },
      ...staffRoles.map(r => ({
        id: r.id,
        allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageMessages],
      })),
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
      { name: SCORE,   match: /mafia-?score/,   topic: 'Jadval-e bazikon-ha — har saat update mishe' },
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
