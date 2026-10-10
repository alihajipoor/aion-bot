# AION Coin

The server's currency: earned in voice and by inviting people, spent in the
shop on gift cards and server perks. Rules agreed with Ali on 2026-10-09.

Code: `apps/bot/src/lib/economy/rules.ts` (every rule, pure and tested),
`lib/economy/ledger.ts` (every balance write), `modules/economy/` (Discord),
`commands/{coins,shop,orders,eco}.ts`. Tests: `apps/bot/test/economy*.test.mjs`,
the ledger ones against a real Postgres (PGlite).

---

## Earning

| How | Coins | Conditions |
|---|---|---|
| Voice | 1 per hour, credited by the minute | verified · not in AFK or an excluded room · not deafened · account 30+ days old · at least one other person who also qualifies in the room |
| Invite | 1 per invitee | paid when the invitee is **verified**, not when they join · joined through the inviter's link after launch · account 30+ days old when they joined · new to the server · once per person, ever |

No daily cap. Staff earn and buy like everyone else.

This is a separate count from the activity leaderboard, on purpose: the board
counts anyone in voice (AFK, alone, deafened), this pays out gift cards.

- **Invitee leaves within 24h of verifying** → the coin is taken back from the
  inviter. If they already spent it, only what is left is taken, and the log
  says how much could not be.
- **Guessed invites** (the bot inferred the inviter because it was offline when
  they joined) are **held** until a Dev confirms them with `/eco invites`.
- **Vanity link** joins credit nobody.

## Losing coins

- **Leaving the server** (or being kicked/banned) → the whole balance is lost,
  and pending orders are cancelled **without** a refund. The economy-log says
  how many coins went. Coming back starts from 0.
- **90 days with no voice at all** → the balance expires. A DM warning goes out
  7 days before. Orders already paid for are still delivered.

## The shop

Each product has a price, an optional **monthly stock** and an optional
**per-member monthly limit**. Months turn at midnight Tehran time.

**Monthly stock is the budget.** At $100/month the opening catalogue is:

| Product | Cost | Per month | |
|---|---|---|---|
| Discord Nitro — 1 month | $10 | 3 | $30 |
| Nitro Basic — 1 month | $3 | 4 | $12 |
| Steam card $10 | $10 | 2 | $20 |
| Spotify gift card $10 | $10 | 1 | $10 |
| Telegram Premium — 1 month | $5 | 2 | $10 |
| PUBG UC / CoD Points / Valorant Points | $5 | 1 each | $15 |
| **Total** | | | **$97** |

Google Play, App Store, PlayStation and Xbox cards are in the catalogue
**switched off** — turning one on adds to the budget. Neoxify VPN and the
server perks (custom role, VIP, permanent room, emoji, shout-out, Mafia slot)
cost nothing and have no stock limit. Prices start at about 18 coin per dollar;
tune them with `/eco edit`.

### An order's life

1. Member picks a product in `#shop` (or `/shop`) and confirms. The price leaves
   their balance immediately and the order card appears in `#orders`.
2. A **Dev** presses one of:
   - **📨 Ersal-e code** — type the code; the bot DMs it to the buyer and marks
     it delivered. **The code is never stored.** If the buyer's DMs are closed,
     nothing is marked and the Dev is told.
   - **✅ Tahvil shod (dasti)** — delivered some other way.
   - **❌ Rad** — with a reason; the coins are refunded and the buyer told.
3. Until then the buyer can cancel from `/orders` and get the coins back.

Check the region before buying a Steam, Spotify or store card — see the note on
each product.

## Who can do what

| | Dev | PowerAdmin · Consultant | Members |
|---|---|---|---|
| Earn, buy, `/coins`, `/orders` | ✅ | ✅ | ✅ |
| See `#orders`, `#economy-log`, `/eco products · orders · history`, `/coins user:` | ✅ | ✅ | ❌ |
| Deliver / reject orders, give / take, products and prices, held invites, freeze, launch | ✅ | ❌ | ❌ |

The guild owner counts as Dev.

## Commands

| Command | |
|---|---|
| `/coins [user]` | balance, progress to the next coin, invite coins, expiry date |
| `/shop` · `/orders` | browse and buy · your orders, cancel a pending one |
| `/eco launch` · `/eco pause` | start (or resume) · stop earning and buying; balances stay |
| `/eco seed` | add the opening catalogue to an empty shop |
| `/eco add` · `edit` · `remove` · `products` | the catalogue; `edit stock:-1` is unlimited, `description:-` clears |
| `/eco give` · `take` (reason required) · `history` | adjustments are refused rather than going below zero |
| `/eco orders [status]` · `/eco invites` · `freeze` · `unfreeze` · `refresh` | |

Every coin movement other than voice minutes is posted to `#economy-log`.

## Setting it up

```powershell
node tools/setup/economychannels.mjs            # dry run
node tools/setup/economychannels.mjs --apply    # creates AION BANK
```

Then in Discord: `/eco seed`, adjust prices with `/eco edit`, and `/eco launch`
when announcing it. Only joins after the launch moment can earn an invite coin.

The rules (minutes per coin, account age, company, excluded rooms, 24h, 90 days)
are settings in `guilds.config.economy` with defaults in
`packages/db/src/settings.ts`. Saving the panel's settings page cannot switch
the economy off: launch state belongs to `/eco` alone.

## Known limits

- The "new to the server" check only sees joins the bot recorded, as in the
  giveaway: someone from before the bot who leaves and returns through a friend's
  link reads as new.
- Row locks stop double spending; the tests prove it on PGlite, which runs one
  connection at a time. True concurrent access is enforced by Postgres's
  `FOR UPDATE` and the balance check constraint, not by a test.
