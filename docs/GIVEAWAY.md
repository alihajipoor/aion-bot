# Invite giveaway

The prize structure and rules Ali settled on 2026-09-12, and the runbook for
running one. The code is `apps/bot/src/lib/invites.ts` (scoring) and
`apps/bot/src/commands/giveaway.ts` (the commands).

---

## Prizes

**1st place** — the winner picks one:

| Option | Note |
|---|---|
| WoW *Classic Forever* **Epic** bundle | Battle.net region matters |
| $60 Steam gift card | Steam wallet codes are region-locked |
| 1 year Discord Nitro | Carries 2 boosts/month they can point at Λ I O N |
| $60 USDT | No region problem at all |

**2nd place** — the winner picks one: WoW *Classic Forever* **Heroic** bundle ·
3 months Discord Nitro · $30 Steam gift card · $30 USDT

First and second place are the Epic and Heroic tiers of the same WoW bundle,
which is worth saying out loud in the announcement: it makes the gap between
the places legible to anyone who plays.

**3rd place** — the winner picks one: 1 month Discord Nitro · $15 Steam gift card ·
$15 USDT

> **Check redemption before announcing a winner.** Steam has long restricted
> Iranian accounts and Battle.net has the same problem, so a gift card bought
> in the wrong region is a prize the winner cannot open. Nitro gifts and USDT
> are immune to this. Ask the winner which store actually works for them
> *before* buying anything.

### Costs nothing, and already built

- **Permanent custom role** for the top three — own colour, own name, own badge
  from `assets/role-icons` (`tools/setup/roleicons.mjs --from`).
- **`Λ | Legend`** nickname prefix; `modules/nickguard.ts` already enforces it.
- A pinned **Hall of Λ** post carrying the final board.
- Their own permanent voice room in the Mansion.
- **Recruiter tier at 30 qualified invites**: the `ʀᴇᴄʀᴜɪᴛᴇʀ│𝙳𝙰𝚅𝙰𝚃│•` role and
  icon, granted and removed by the bot automatically. It lasts for the giveaway
  only — the sweep strips it from everyone once nothing is running, so it cannot
  be left behind on someone after the fact.

---

## Rules

A qualified invite is a person who:

1. joined through your link **during** the giveaway,
2. whose account was **already 30 days old** when they joined,
3. and who **completed verification**.

Each person counts **once, ever** — rejoining does not stack, and someone who
was already a member before the giveaway is not a new join.

**Leaving does not take the credit away**, and there is **no activity
requirement** — joining and verifying is the whole bar. Neither is advertised in
the announcement: they are how the scorer behaves, not selling points, and
spelling them out only reads as an invitation to bring people who leave.

Alt accounts disqualify the inviter entirely, not just the fake invites. That
sentence does more work than any detection could.

### The floors: 100 / 50 / 30

Each place has its own bar — 100 for first, 50 for second, 30 for third — and a
place below its bar goes unawarded however high that person sits on the board.

The risk, recorded because it was raised and overruled rather than missed: the
server has ~148 members, so 100 invites from one person means adding two-thirds
of the server single-handed. First place may well go unawarded. Second and third
are reachable.

Note that third place and the recruiter role now sit at the same number, so
anyone eligible for third is already wearing the role.

`floors` is stored per giveaway rather than compiled in, so the numbers can be
lowered mid-run if the board stalls:

```bash
gh workflow run ops.yml -f task=giveaway-floors -f floors=40,25,15
```

That writes the row and rewrites the announcement together, so the pinned rules
never disagree with the board.

A floor is a bar, not a queue position — if the runner-up misses it, second
place goes unawarded rather than sliding down to whoever is next.

---

## Runbook

```bash
/giveaway start title:"AION Invite Contest"    # 21 days, floors 100/50/30
```

Admin subcommands are **Dev-only** (plus the guild owner, so the server cannot
lock itself out). `board` and `man` are open to everyone.

Only joins from that moment count, so start it when you announce it.

| Command | Who | What |
|---|---|---|
| `/giveaway board` | anyone | Public leaderboard with the floors shown |
| `/giveaway man` | anyone | Their own invitees, and the reason beside each one that did not count |
| `/giveaway check user:` | admin | The same, for someone else |
| `/giveaway review` | admin | Attributions the bot **inferred** rather than observed |
| `/giveaway close` | admin | Freezes the result into the record and posts the final board |
| `/giveaway cancel` | admin | Drops it with no result |

The announcement is posted to `•︱🎁│𝙶𝙸𝚅𝙴𝙰𝚆𝙰𝚈` every 24 hours with an
`@everyone` ping, replacing the previous one rather than stacking. Three buttons
ride under every repost:

| Button | What it does |
|---|---|
| 🔗 لینک دعوت من | Mints a permanent personal invite, ephemeral |
| 📊 دعوت‌های من | Their own invitees, with a reason beside each that did not count |
| 🏆 جدول | The live board |

The link button is worth more than convenience. Discord credits an invite made
through the API to the *application*, not to the person who asked for it, so
ownership is recorded in `invite_cache` and the join handler reads it back —
every join through a minted link is attributed exactly rather than inferred from
a uses diff.

**Run `/giveaway review` before paying anyone.** When a join arrives through an
invite created while the bot was down, the inviter is a best guess. It is a
small list and usually correct, but it is the one number worth a human glance.

**Point people at `/giveaway man` when they argue about their count.** It lists
every invitee with ✅ or ❌ and says why — `account kheili jadid bood`,
`hanooz verify nakarde`, `ghablan azaye server bood`. A bare number invites an
argument; the list settles one.

### Known limit

The "already a member" check can only see joins the bot recorded. Someone who
predates the bot, leaves, and rejoins through a friend's link will read as new.
Rare, and visible in `/giveaway man`.
