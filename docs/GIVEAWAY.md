# Invite giveaway

The prize structure and rules Ali settled on 2026-09-12, and the runbook for
running one. The code is `apps/bot/src/lib/invites.ts` (scoring) and
`apps/bot/src/commands/giveaway.ts` (the commands).

---

## Prizes

**1st place** — the winner picks one:

| Option | Note |
|---|---|
| WoW *Classic Forever* / Epic expansion bundle | Battle.net region matters |
| $60 Steam gift card | Steam wallet codes are region-locked |
| 1 year Discord Nitro | Carries 2 boosts/month they can point at Λ I O N |
| $60 USDT | No region problem at all |

**2nd place** — the winner picks one: 3 months Discord Nitro · Heroix bundle ·
$30 Steam gift card · $30 USDT

**3rd place** — 1 month Nitro **plus** either a $15 Steam gift card or $15 USDT

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
- **Participation tier at 3 qualified invites**: a permanent recruiter role and
  icon, so the people who cannot reach the podium keep inviting anyway.

---

## Rules

A qualified invite is a person who:

1. joined through your link **during** the giveaway,
2. whose account was **already 30 days old** when they joined,
3. and who **completed verification**.

Each person counts **once, ever** — rejoining does not stack, and someone who
was already a member before the giveaway is not a new join.

**Leaving does not take the credit away.** The inviter did their part; what the
invited person does afterwards is not theirs to control.

There is deliberately **no activity requirement**. Joining and verifying is the
whole bar.

Alt accounts disqualify the inviter entirely, not just the fake invites. That
sentence does more work than any detection could.

### Why these thresholds, not 100/50/20

The server has ~148 members. One person reaching 100 invites means adding
two-thirds of the server alone. A target nobody can reach produces *less*
growth than no giveaway, because people do the arithmetic in week one and stop.

Places are therefore **ranked with a floor**, defaulting to 10 / 7 / 5. The
floor stops a prize being won on two invites; the ranking keeps everyone racing
the person above them to the last day. A floor is a bar, not a queue position —
if the runner-up misses second place's floor, second place goes unawarded
rather than sliding down.

---

## Runbook

```bash
/giveaway start title:"Musabeghe-ye Davat" days:21    # floors default to 10/7/5
```

Only joins from that moment count, so start it when you announce it.

| Command | Who | What |
|---|---|---|
| `/giveaway board` | anyone | Public leaderboard with the floors shown |
| `/giveaway man` | anyone | Their own invitees, and the reason beside each one that did not count |
| `/giveaway check user:` | admin | The same, for someone else |
| `/giveaway review` | admin | Attributions the bot **inferred** rather than observed |
| `/giveaway close` | admin | Freezes the result into the record and posts the final board |
| `/giveaway cancel` | admin | Drops it with no result |

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
