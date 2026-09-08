# AION

All-in-one Discord bot and web panel for the AION community server.
Replaces Carl-bot, ServerStats, Statbot, Invite Tracker, AutoReacter and ProBot
with a single service. Music bots stay.

## Why this exists

The server's security model is built entirely on **category-level permission
overwrites**, not guild-level permissions. Three orthogonal role families make
cross-category power structurally impossible rather than merely checked in code:

| Family | Example | Guild permissions |
|---|---|---|
| Identity | `Consultant`, `Global`, `Moderator` | **none** — colour and member-list grouping only |
| Scope | `P . Global`, `G . MODERATOR` | **none** — all power via category overwrites |
| Sanction | `Public Banned`, `Game Banned` | **none** — category-level denies |

Because a scope role holds nothing at guild level, a Public Moderator *cannot*
act in Game — the permission does not exist for them there.

Two Discord behaviours make this work without hacks:

- **Scoped moves are enforced natively.** `MoveMembers` is required in *both*
  the source and destination channel, so granting it on one category only means
  cross-category moves fail at the API.
- **Scoped mutes need no rejoin trick.** A `<section> Muted` role denies `Speak`
  on that category alone; it follows the user within the section, survives
  rejoin, and does nothing elsewhere. Discord's native server-mute is guild-wide
  and is therefore never used for punishment.

## Layout

```
apps/bot         discord.js 14 gateway client
packages/db      Drizzle schema + migrations (PostgreSQL)
tools/scan       read-only guild scanners and diff tools
tools/setup      structure sync, permission templates, migrations
deploy           systemd units and provisioning scripts
docs             architecture plan and feature spec
```

## Setup

```bash
npm install
cp .env.example .env      # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, LIVE_GUILD_ID
npm -w @aion/db run generate    # regenerate migrations after a schema change
npm -w @aion/bot run register   # register slash commands to the guild
npm -w @aion/bot run dev
```

Node 20+. The VPS runs Node 20, which has no TypeScript type-stripping, so the
bot always runs from `dist/` — `npm run build` first.

## Structure tooling

The reference guild is the source of truth for server structure. These are
**create-only**: they never delete anything not explicitly listed.

```bash
node tools/scan/scan.mjs                      # snapshot a guild
node tools/scan/diff.mjs                      # reference vs live
node tools/setup/sync.mjs                     # dry run
node tools/setup/sync.mjs --apply             # apply
node tools/setup/audit.mjs                    # permission bug audit
```

Deliberate deviations from the reference live in `tools/setup/overrides.mjs` —
including roles that must never be recreated and overwrites where the live
server is correct and the reference is wrong.

## Constraints that shaped the design

The VPS has **1.9 GB RAM shared with another bot**. Consequences:

- No Docker, no Redis. Postgres `LISTEN/NOTIFY` handles bot↔panel messaging.
- `next build` OOMs on the box, so the panel is built in CI and deployed prebuilt.
- Every systemd unit carries a hard `MemoryMax`.

## Persian text

`apps/bot/src/lib/text.ts` is not optional polish. Discord's `gg sans` has no
Arabic coverage and only cozy-mode message bodies get bidi isolation — embeds do
not. Every interpolated value is wrapped in `FSI…PDI`, digits adjacent to
Persian are prefixed with `ALM` (RLM does not work there), and `ي→ی` / `ك→ک` are
normalised before any comparison or keyword match.
