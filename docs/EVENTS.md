# Events and games — design

Written 2026-09-08, after the per-game voice channels were removed. The
section now has two permanent voice channels (`EVENT HALL`, `Stream Voice`),
two public text channels (`EVENT-NEWS`, `EVENT-CHAT`) and three staff
channels. One or two events run at a time, not ten.

---

## The finding that shapes everything

**Iranian Mafia is run by a human گرداننده.** Every scenario in circulation —
پدرخوانده, شب‌های مافیا — is written around a narrator who wakes roles, takes
their actions privately, and announces outcomes. Players expect a person in
that seat.

Most Discord mafia bots automate the narrator away. Doing that here would
build something the room does not want.

So AION should be a **GM console, not a referee**. It does the things a human
narrator physically cannot do in a Discord voice channel, and leaves the
judgement to them:

- Silence everyone the instant night falls, and unmute at dawn
- Keep the dead muted — the single most common way a game gets ruined
- Deal roles by DM so nobody sees a card over a shoulder
- Hold the vote and count it honestly
- Remember who did what, and produce the recap

That division is the whole design. The bot is the table, the lights and the
scorekeeper. The گرداننده is still the گرداننده.

---

## Event lifecycle

Modelled on the PRIVATE interface, which already works and which staff know.

A new staff-only channel, **`•︱🎛│𝙴𝚅𝙴𝙽𝚃-𝙸𝙽𝚃𝙴𝚁𝙵𝙰𝙲𝙴`** in QUIDDITCH, holds one
persistent branded panel. Visible to `E . MODERATOR`, `E . Global`,
`PowerAdmin`, `Consultant`, `Dev`.

```
Draft ──▶ Announced ──▶ Running ──▶ Ended
  │           │             │          └── recap card, channels swept
  │           │             └── the game module drives
  │           └── signup card in EVENT-NEWS + native Scheduled Event
  └── modal: game, title, capacity, when
```

**Draft.** A button opens a modal: which game, a title, capacity, and when.
Nothing is public yet.

**Announce.** Posts a signup card to EVENT-NEWS with a Join button and a live
roster, and creates a **native Discord Scheduled Event** pointing at the voice
channel — that buys reminders, an interested-list and the server's event tab
for free rather than reimplementing them.

**Start.** Moves the signed-up members into the room and hands control to the
game module. Only the channels that game actually needs get created.

**End.** One button. It posts a recap, sweeps whatever it made, and records
the result. Nothing is left behind for someone to tidy up on Monday.

### Channels, and how to avoid clutter

Three options were on the table. The recommendation is the third.

1. **Always reuse EVENT HALL.** Zero clutter, zero creation — but two
   overlapping events collide, and Mafia has no private room for the mafia
   team.
2. **Always create per-event channels.** Handles concurrency, but leaves the
   category churning even when only one thing is happening.
3. **Reuse first, create on demand.** The first live event takes EVENT HALL
   and EVENT-CHAT — already permission-correct, already familiar. A second
   concurrent event gets a temporary room. Games that need a private side
   channel get one regardless, deleted at the end.

Under option 3 a normal night creates **one** extra channel (the mafia room)
and deletes it an hour later.

---

## Mafia — the GM console

**Setup.** Staff picks a scenario and the bot checks the roster size against
it. Roles go out by DM as cards: role name, side, ability, and what happens
when they are woken.

**Night.**

- Bot server-mutes everyone in the voice channel. Nobody can talk over the
  night, which is the rule that is hardest to enforce by voice alone.
- The گرداننده gets a private console — alive players as buttons. They tap
  the shot, the save, the investigation. The bot resolves the interaction and
  reports the outcome **to the گرداننده only**, so the narration stays theirs.
- The mafia team's private text channel opens for the night and closes at dawn.

**Day.**

- Everyone is unmuted; the dead stay muted. Permanently, automatically. That
  one behaviour is worth more than the rest of the module combined.
- The bot posts what happened, then runs defence timers and a vote with
  buttons, showing a live tally and flagging when a majority is reached.

**End.** A recap card: which side won, the full role table, who voted for
whom each round, and how long it ran.

## Esm Famil

Rules as played: **20 points** when you are the only one with an answer, **10**
for a valid answer others also had, **5** for a duplicate, **0** for blank or
wrong.

- A random Persian letter, drawn from letters that actually start words —
  ژ, ء and friends excluded, or every round dies on the first column.
- Configurable columns: اسم · فامیل · شهر · کشور · غذا · حیوان · رنگ · اشیا
- A timer, and one modal per player.
- **Normalisation decides whether this game works at all.** `ي` vs `ی`, `ك`
  vs `ک`, zero-width non-joiners, trailing spaces, diacritics — without
  folding them, "تهران" and "تهران‌" score as two different cities and the
  scoreboard is nonsense. `normalizePersian()` in `lib/text.ts` already does
  this.
- Contested answers go to a **vote card** rather than an algorithm. Whether
  کیوی counts as a food is an argument the room should have, exactly as it does
  around a table.

## 20 Soali

The lightest of the three. One player takes the subject in a modal; the rest
ask in chat; the thinker answers with **بله / نه / تا حدی** buttons. The bot
counts to twenty, shows the questions remaining, and closes on a correct guess
or on running out.

---

## What all three share

- **`Event Banned` is respected everywhere** — it already exists as a role.
- **Results feed the leaderboard.** Wins, MVPs and attendance are activity
  like any other, and the banner engine already renders boards.
- **Recaps are rendered cards**, not text dumps. People screenshot those.
- **The interface never leaves state behind.** Every channel a game creates is
  owned by the event that made it and dies with it.
