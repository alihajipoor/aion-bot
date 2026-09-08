# AION — what to build next

Written 2026-09-08, after Phases 1–8. Ordered by what actually changes life on
the server, not by how interesting it is to build. Every item names the gap it
closes; anything that is only "other bots have it" was left out.

Context that shapes every call below: **139 members, voice-first, Persian
speaking, one 1.9 GB VPS shared with another bot.** Compute is the scarce
resource, so anything Discord can do natively should be done natively.

---

## Tier 1 — gaps that are risks

These are things the server used to have, or never had and needs.

> **Items 1–3 shipped on 2026-09-08.** AutoMod rules are live and owned by
> `tools/setup/automod.mjs`; the voice guard runs in `modules/voiceguard.ts`;
> the watchdog runs from `aion-watchdog.timer` every five minutes. Item 4, the
> warn tier, is still open.

### 1. There is no spam or raid protection at all

ProBot was removed and nothing replaced its automod. Right now a single
motivated person with an alt account can flood a channel and the only response
is an admin noticing and reaching for `/punish`.

**Native AutoMod is free and runs on Discord's side — zero CPU here.** It
covers mention spam, spam content, keyword lists and member profiles, and it
can block, alert, or time out automatically. AION can *create and own* these
rules through the API, so it stays one bot rather than two, and hits already
have somewhere to land: `logbus` has an `automod` log type that has never
fired once.

What to configure:

- Mention cap per message (5 is the usual starting point)
- Block spam content
- A keyword list covering Persian profanity and the scam phrasings that
  actually circulate in Iranian servers — the default English lists are close
  to useless here
- Action: delete + alert the mod channel; timeout only for repeat hits

**AutoMod does not cover joins.** A join-rate guard belongs in the bot: N joins
inside M seconds → pause verification approvals, alert Consultants, and post a
notice. Cheap to write, and it is the difference between an inconvenience and
an evening lost.

### 2. Voice abuse is completely unguarded

This matters more here than anywhere else, because this is a voice server.
Nothing native covers voice at all. Today, someone can:

- Hop in and out of a channel repeatedly to spam the join sound
- Spam the soundboard
- Scream over everyone, and the only fix is an admin who happens to be awake

A **voice flood guard** — more than N voice-state changes in M seconds → short
automatic server-mute, logged, liftable — is a small module, and it is the
single most differentiated thing AION could have. No general-purpose bot does
this well, because most servers are text-first. This one is not.

### 3. Nobody finds out when the bot dies

`Restart=always` handles a clean crash. It does not handle a crash loop, a
full disk, Postgres refusing connections, or the token being revoked. The
server now depends on AION for moderation, verification and logging — a silent
failure at 3am is a real outage.

The pieces are already here: SMTP works, backups prove it. Add a heartbeat row
the bot updates every minute, a small cron that emails if it goes stale, and a
disk-space check (Postgres plus seven days of local backups on a small box
will eventually matter).

### 4. Moderation has only two settings: mute and ban

Most incidents deserve neither. They deserve "this was recorded, and it counts
next time." The `cases` table already exists and already stores everything a
warning needs.

Adding a **warn** action plus an escalation ladder — 3 warns inside 30 days,
and the next `/punish` pre-selects a longer duration — does two things: it
gives moderators a proportionate response, and it makes decisions consistent
across ten different admins instead of depending on who is on shift.

---

## Tier 2 — the reasons people come back

### 5. Levels and role rewards, from data already being collected

`activityDaily` has voice seconds and messages per member per day. Levels are a
thin module on top of a table that already exists.

Weight it toward **voice, not messages** — that is the culture here, and
message-weighted XP quietly teaches people to spam. Role rewards give people
something to chase, and the daily leaderboard already provides the public
proof.

This is the highest-retention feature on the list, and the cheapest to build,
because the hard half (accurate activity tracking that ignores AFK, deafened
and alone-in-channel) is already done and correct.

### 6. Streaks and a monthly personal recap

A daily streak is one column and a nightly job. A **personal monthly recap
card** — your voice hours, your rank, who you spent the most time in voice
with — is a banner render, and the banner engine now exists.

People screenshot these. It is free marketing for the server, and it costs one
render per member per month.

### 7. A self-assign role panel

Interests and notification roles ("ping me for Mafia night", per-game roles)
behind a branded button panel. Cuts the admin work of handing out roles by
hand, and it is a direct reuse of the design system just built.

### 8. Events, which is what makes Phase 9 actually happen

Mafia, Esm Famil and 20 Soali will be commands nobody remembers to run unless
something schedules them. A small event module — announce, signup button,
reminder DM, auto-create the voice room, ping the signups — turns three games
into a weekly reason to show up.

**Build this alongside Phase 9, not after it.** The games without the
scheduling are features; with it, they are events.

---

## Tier 3 — free wins and polish

- **Discord Onboarding + Server Guide.** No code. Questions on join that
  assign roles and reveal channels, so nobody meets a wall of 40 channels.
  Requires Community enabled, and needs thought about how it sits alongside
  the verification gate — probably: onboarding picks interests, verification
  still gates access.
- **Native polls.** Free, built in, no bot involvement.
- **A forum channel for suggestions and support**, instead of a ticket bot.
  Threads, resolution states and search, for nothing.
- **Welcome card** in Townhall when someone passes verification — avatar,
  member number, in the AION frame.
- **Panel: activity heatmap.** When is the server actually busy? Schedule game
  nights then instead of guessing. The data is already in `activityDaily`.
- **Panel: health page.** Uptime, memory, DB, last backup, last heartbeat.

---

## Deliberately not recommended

- **Music.** Bandwidth, CPU and legal exposure, on a box with 1.9 GB shared
  with another bot. This is the one feature most likely to take the server
  down.
- **Economy and currency.** A large surface that pays off at thousands of
  members, not 139. It also quietly rewards grinding over talking.
- **A ticket bot.** A forum channel does the same job with no code and no
  memory.
- **AI chat features.** Ongoing cost per message, and the novelty fades in a
  week.

---

## What I would do first

**Voice flood guard, then AutoMod rules, then alerting.** Those three close the
gaps where the server is currently exposed, and together they are smaller than
any single Tier 2 feature.

Then **levels**, because it is the largest retention gain per line of code on
this list and the data is already sitting there.

Then **Phase 9 with the event system built into it**, so the games arrive with
a reason to attend.
