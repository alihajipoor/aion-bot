# Mafia — modes, rules, and the console

Written 2026-09-13 from Ali's spec. **His rules are canonical.** Iranian Mafia is
played in *scenarios* and every source online defines the roles differently —
one reference has Shahrdar silencing players, another has Kalantar interrogating
and killing. Neither matches this server's game. So nothing here is "corrected"
against an outside source; research was used only to fill gaps Ali did not
specify, and every such fill is marked **[filled]** so it can be overruled.

Anything still marked **[ASK]** is unresolved and must not be guessed at: a rule
invented at 2am during a live game is how a game gets ruined.

---

## Modes

| Mode | Status | Day structure |
|---|---|---|
| Persian Mafia | live | Ejma → Defa → Ray-giri |
| **Mafia Scum** | to build | straight to vote, two rounds |

**Mafia Scum's defining rule**: players may *claim their role out loud* while
speaking. A mafia player can claim Doctor. That is the whole point — the game
becomes about whose claim you believe, not about extracting information.

---

## Mafia Scum — roles

### Gray (individual, not a team)

Usually only one of these appears; both only in a large game.

**Traitor Police (پلیس خائن)**
- At role distribution the bot DMs them: pick a side.
- Never sees mafia chat, never learns who the mafia are, either way.
- Counts as **Shahr** for vote and player counts, always.
- Plays exactly as a Shahrvand Sade.
- If they picked mafia and mafia wins, they are announced as a winner and scored
  on the mafia team.
- Detective reads them as **Shahr**.

**Natasha (ناتاشا)**
- Always on the mafia team, but never sees mafia chat and never learns the team.
- Counts as **mafia** for vote and player counts.
- Night: silences one player. That player cannot speak the following day.
- **Each player may be silenced only once per game** — no repeats.
- Detective reads them as **mafia**.

### Shahr (team)

| Role | Ability |
|---|---|
| **Sniper** | Shoots at night. Total bullets set by God at setup; **one shot per night** max. |
| **Rooyintan** (رویین‌تن) | Cannot be killed by any shot. Removed only by vote, by God, or by Terrorist. |
| **Saghi** (ساقی) | Makes one player drunk at night; that player's ability does not work that night. |
| **Shahrdar** (شهردار) | May cancel a completed final vote. Limited uses, set by God. |
| **Kalantar** (کلانتر) | Gives a gun to another player at night. Never shoots themselves. |
| **Doctor** (دکتر) | Saves one player per night, self included. Unlimited. |
| **Detective** (کاراگاه) | Asks one player's **side** per night — "mafia" or "shahr", never the role. |
| **Shahrvand Sade** | Nothing. |

### Mafia (team)

| Role | Ability |
|---|---|
| **Mafia Sade** | Nothing. |
| **Terrorist** | If eliminated **by vote only**, takes one player out with them. |
| **Don** (دُن) | Shoots one player per night. Reads as **Shahr** to the Detective. |

---

## Interactions that decide correctness

These are where the bugs live. Written as rules the resolver must obey.

### Night resolution order

Order is not cosmetic — a different order produces different survivors.

1. **Saghi** resolves first. Their target's ability does nothing tonight.
2. **Kalantar** hands over the gun (no effect until it is fired).
3. **Doctor** marks a save.
4. **Shots** resolve: Don, then Sniper.
5. **Detective** result is computed.
6. **Natasha** silence is applied.

### Drunkenness

Saghi's target loses their ability that night, whatever it is:

- Doctor drunk → the save fails.
- Don or Sniper drunk → the shot does not fire (bullet **[filled]** not spent).
- **Rooyintan drunk → immunity is gone; a shot kills them that night.**
- Detective drunk → the answer comes back **inverted**.
- Natasha drunk → nobody is silenced; that target is **[filled]** still spent.
- Kalantar drunk → the gun is not handed over.

### Detective results

The Detective learns a **side**, not a role.

| Target | Answer |
|---|---|
| Don | **Shahr** — always inverted |
| Natasha | mafia |
| Traitor Police | Shahr, whichever side they chose |
| anyone else | their true side |

Asked while drunk, the answer above is inverted again. Asking about the Don on a
later, sober night still returns Shahr — the Don's disguise is permanent, not a
one-time miss.

### Guns

- **Sniper** shoots at night, one per night, from a fixed total.
- **Don** shoots at night, one per night.
- **Kalantar's gun** is fired **during the day** by whoever holds it, on any day
  from the one after they receive it onward. The victim's **role is announced
  immediately and publicly** — the only death in the game that reveals a role on
  the spot. The holder may be mafia; that is the risk.
- Rooyintan is immune to all three **[filled]** — a shot is a shot.
- A shot on a Shahr member **kills that member**. The Sniper is not punished; the
  bullet is simply spent and a teammate is dead.
- A Doctor save blocks **[filled]** every shot on that player that night, not
  just the first.

### Terrorist

Triggers **only** on elimination by vote. Not on any shot, not on a God
elimination. **[filled]** They pick their target immediately, and it resolves
before the next phase begins.

### Rooyintan

Removed only by: vote, God's eliminate button, Terrorist, or a shot on a night
they were drunk.

---

## Day structure

1. **Day 1 goes straight to the vote.** No lobby, no challenge.
2. Every player speaks in turn.
3. **Round one vote.** Counts are hidden from everyone until God ends the phase.
4. On reveal: anyone with **2 or more votes** goes to round two.
5. Those players each get a turn to defend.
6. **Round two vote**, again hidden until God ends it.
7. Highest vote is eliminated. **A tie eliminates nobody** — night falls with
   everyone alive.
8. Eliminated player's role is **[filled]** not revealed — except by Kalantar's
   gun.

God may jump to any phase — lobby, challenge, defence, vote — at any time.

---

## Win conditions — God calls it

**The bot never ends a game on its own.** It keeps the counts and shows them on
the console; God presses the win button.

This was a deliberate choice. Natasha counts as mafia without being on the mafia
team, and the Traitor counts as Shahr while possibly winning with mafia, so an
automatic parity check has edge cases — and an edge case that fires mid-game
ruins that game for everyone in it. A human deciding is slower and cannot be
wrong in a way nobody saw coming.

The console shows, live:

```
mafia 3  ·  shahr 4        (Natasha counted as mafia, Traitor as shahr)
```

Force-win buttons for either side are always available.

---

## Console and setup

**This is the Discord console**, the Components V2 panel in the event interface
channel where God already presses Shab and Rooz — not the web panel. Every
option below is a button or a select menu in that message. Nothing here is
configured on the website.

God configures before the game and adjusts during it.

**Roles** — every role individually on or off, with counts. A game without a
Saghi is a valid game.

**Text channel rules per phase** — for each phase, one of: free text, reactions
only, specific emoji only (👍/👎), or locked. Notably: **during Ray-giri the
channel is locked** and the vote box is the only way to vote.

**Vote phase** — auto-close with a timer, or manual with a God button. Toggle.

**Signup gating** — restricted to the Mafia Player role, or open to everyone.

**Per-role limits** — sniper bullets, shahrdar vetoes, kalantar guns.

**God overrides** — force a mafia win, force a shahr win, eliminate any player,
skip or jump to any phase, set the MVP.

**Player lockout** — anyone who signs up loses access to the event category's
staff channels for the duration, so a moderator who is playing cannot read the
console or the mafia room. Restored at teardown.

---

## Surrounding features

**Mafia guide channel** — a wiki per mode: roles, abilities, day structure, house
rules. Later, a button here starts a knowledge test that grants the Mafia Player
role on a pass.

**Mafia Player role** — no permissions. Used to ping signups, and eventually
gated behind the test. For now, whether it is required is a setup toggle.

**Mafia history channel** — one post per finished game: who won, the roster, the
MVP God picked. Pings the Mafia Player role only, never @everyone.

**Scoreboard** — per player: games, wins and losses by team, MVP count.
