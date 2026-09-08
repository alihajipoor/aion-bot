# AION Discord Bot + Web Panel — Architecture & Implementation Plan

Target guild: AION public Discord (existing, populated)
Panel: https://aion.neoxify.com
Host: <vps-ip> — Ubuntu 22.04, 2 vCPU, 1.9 GB RAM, 12 GB free, shared with `azerothshop-bot`

---

## 0. Hard constraints that shape every decision

| Constraint | Consequence |
|---|---|
| 1.9 GB RAM, **no swap**, shared with a live bot | No Docker, no Redis. Add 2 GB swap. Hard `MemoryMax` on every unit. |
| `next build` needs >1 GB | Panel is **built in GitHub Actions**, never on the VPS. Ship prebuilt artifact. |
| Server already exists with members | Setup engine **reconciles**, never wipes. Create-only + report extras. |
| Discord has no per-category mute/ban | Implemented as bot-managed roles with **category-scoped channel overwrites**. |
| Channel name edits: 2 per 10 min | Voice counters refresh ~6 min. Live numbers live in an edited *message* + the panel. |
| `gg sans` has no Arabic coverage; embeds lack bidi isolation | All Persian output needs explicit bidi isolation. See §11. |
| Boost level 0 now, Level 3 soon | Boost-gated assets are feature-flagged and auto-applied on tier change. |

---

## 1. Stack

Monorepo, pnpm workspaces, TypeScript end to end.

```
aion/
  apps/
    bot/                 discord.js 14.27.x  (v15 is still draft — not production)
    web/                 Next.js 16.3.x App Router, Tailwind v4, shadcn/ui
  packages/
    db/                  Drizzle ORM + Postgres schema + migrations
    shared/              types, permission resolver, bidi/text utils, config contracts
    render/              Satori + resvg-js banner rendering (shared by bot & panel)
  deploy/
    systemd/  caddy/  scripts/
  .github/workflows/     build → versioned tarball release
```

**Drizzle, not Prisma.** Prisma's query engine is a separate heavy process; Drizzle is a thin layer over `pg`. On 1.9 GB that difference is decisive, and the log/stats queries want real SQL.

**No Redis.** One bot process means cooldowns, ignore-lists and caches are in-memory `Map`s. Bot↔panel realtime uses Postgres `LISTEN/NOTIFY`. Saves ~100 MB and a moving part.

**Satori + resvg-js for banners.** Banners are authored as HTML/CSS with real webfonts (Vazirmatn for Persian), so leaderboard images and the panel share one design system. Canvas drawing cannot do that.

---

## 2. Runtime layout on the VPS

Four units, all hardened in the same style as the existing `azerothshop-bot.service`:

| Unit | Purpose | MemoryMax |
|---|---|---|
| `aion-bot.service` | discord.js gateway client | 384M |
| `aion-web.service` | Next.js standalone, `127.0.0.1:3100` | 256M |
| `postgresql` | system package, tuned small (`shared_buffers=128MB`, `max_connections=20`) | ~150M |
| `caddy` | `:80/:443` → `127.0.0.1:3100`, auto-TLS | ~30M |

Budget: 75 (azeroth) + 384 + 256 + 150 + 30 + ~250 (OS) ≈ **1.15 GB of 1.9 GB**. Plus 2 GB swap as the safety net.

**Isolation from the existing bot:** own unix user `aionbot`, own directory `/opt/aion`, own Postgres role + database, own systemd units, distinct port. Nothing reads or writes `/opt/azerothshop-bot`. `ufw` gets enabled allowing only 22/80/443 — Postgres binds to localhost only.

---

## 3. Role architecture — the core design

Three orthogonal role families. Keeping them separate is what makes cross-category power leakage *structurally impossible* rather than merely code-checked.

### A. Identity roles — hoisted, coloured, **zero permissions**
`Consultant` · `Power Admin` · `Global` · `Moderator` · `Male Member` · `Female Member`

Purely cosmetic: colour, member-list grouping, identity. They grant nothing.

### B. Scope roles — not hoisted, no colour, **zero guild-level permissions**
`Public Moderator` · `Public Global` · `Game Moderator` · `Game Global` · `Entertainment Moderator` · `Entertainment Global`

All power arrives via category overwrites only.

### C. Sanction roles — bot-managed, not hoisted, **zero guild-level permissions**
`Public Muted` / `Game Muted` / `Entertainment Muted`
`Public Banned` / `Game Banned` / `Entertainment Banned`

### Per-category overwrite matrix (Public shown; Game and Entertainment identical)

| Role | On the **Public** category |
|---|---|
| `Public Moderator` | allow `MoveMembers`, `MuteMembers`, `DeafenMembers`, `ManageMessages`, `PrioritySpeaker` |
| `Public Global` | same as above (ban is a bot-role mechanic, not a Discord permission) |
| `Public Muted` | **deny** `SendMessages`, `Speak`, `AddReactions`, `SendMessagesInThreads`, `RequestToSpeak` |
| `Public Banned` | **deny** `ViewChannel`, `Connect` |

### Why this yields exactly the requested behaviour

- **Scoped move — enforced by Discord itself.** `MoveMembers` is required in *both* source and destination channel. Granting it only on Public means Public→Public works, Public→Game fails, Game→Public fails. No code required for the native right-click path; the bot applies the same check for command-driven moves.
- **Scoped mute — no rejoin hack needed.** Punishment mute is the `<Category> Muted` role, whose deny lives on the category. It follows the user in that category only, survives leave/rejoin automatically, and has zero effect elsewhere. (Discord's native `MuteMembers` server-mute is guild-wide in effect, so it is *never* used for punishment — it stays in the overwrite only for quick in-the-moment suppression inside a mod's own category.)
- **Scoped ban.** `<Category> Banned` denies `ViewChannel` + `Connect` on that category. The user keeps full access to the other two categories, exactly as specified.
- **Role management stays exclusive.** Only `Consultant` and `Power Admin` hold `ManageRoles` at guild level. No scope role has it.

### Hierarchy (top → bottom)

```
AION Bot            ← must sit above every role it manages
Consultant
Power Admin
Global
Moderator
  Public/Game/Entertainment × Moderator/Global   (scope roles)
  Public/Game/Entertainment × Muted/Banned       (sanction roles)
Male Member / Female Member
@everyone
```

---

## 4. `/punish` — scoped, gated, rate-limited

Registered guild-wide, then gated at execution:

1. **Channel gate.** Must be run in that category's designated ban-log channel. `Power Admin`/`Consultant` may use any of the three. Anywhere else → ephemeral rejection.
2. **Scope resolution.** Allowed categories derived from the invoker's scope roles; `Power Admin`/`Consultant` → all three.
3. **Guided flow**, ephemeral, Components V2:
   category select (only the invoker's allowed categories) → duration select (minutes, with a custom option) → reason modal.
4. **Cooldown.** `Global` roles: 10 s minimum between punishments, in-memory per-user. `Power Admin`/`Consultant` exempt.
5. **Apply.** Assign `<Category> Banned`, persist a case row with expiry, schedule removal (timer + startup reconciliation so restarts don't lose it).
6. **Announce.** Public embed in that category's ban channel: target, duration, reason, acting admin, case ID.

Every action gets a per-guild incrementing **case ID**, stored and browsable in the panel.

---

## 5. Verification gate

**Pre-verification visibility:** `@everyone` sees only `#welcome`/`#rules`, `#verify` (+ its voice channel), `#admin-verify` (staff-only), and the public stats category. All other categories deny `ViewChannel` to `@everyone`; `Male Member`/`Female Member` grant it back.

**Flow**
1. Persistent Components V2 panel in `#verify` with a **Verify** button.
2. Button → modal collecting **Name, Age, City** (text) and **Gender**. If the deployed API supports select components inside modals we use one; otherwise gender is a select shown immediately before the modal. *(Verify against 14.27 at build time.)*
3. Submission → request card posted to `#admin-verify` (visible to `Power Admin` + `Consultant` only) with **Approve** / **Decline**.
4. **Approve** → assign `Male Member` or `Female Member` by stated gender, apply the styled nickname, post a confirmation in `#admin-verify` naming the approving admin, and notify the user (DM, falling back to an ephemeral note in `#verify` since Iranian users very often have DMs closed).
5. **Decline** → modal asking for a reason → the user gets a message in `#verify` **visible only to them** with that reason. No role granted.

**Nickname styling**
- Latin names → chosen Unicode style.
- Persian names → left in real Persian (no fake styling — Unicode has no Persian styled variants that render reliably) plus a consistent decorative wrapper so the member list stays uniform.
- **Guard:** nickname cap is 32 characters and Latin styled glyphs are outside the BMP, so each costs 2 UTF-16 units. The styler measures the result and falls back to plain text rather than truncating a name.
- Persian digits normalised; `ي→ی` and `ك→ک` normalised on input.

---

## 6. TempVoice

Join-to-Create hub channel; on join the bot creates a child channel in that category, moves the user in, and grants them owner rights.

Control panel posted in the temp channel (Components V2): **Rename · User Limit · Lock/Unlock · Hide/Unhide · Kick · Block · Invite · Claim · Transfer · Bitrate · Region**.

- `Power Admin` retains access to every temp channel via category overwrite.
- Ownership transfers automatically when the owner leaves; channel is deleted after a grace period once empty.
- Per-user preferences (last name, limit, lock state) persisted and reapplied on next creation.
- Orphan sweep on startup removes temp channels left behind by a crash.

---

## 7. Stats & live displays

**Public stats category** — sits above all others, visible to everyone including unverified:
- Locked voice channels as counters (`Users`, `Online`, `In Mic`), refreshed on a ~6 minute stagger. This is a *hard* Discord limit of 2 name edits per 10 minutes per channel, not a design choice.
- A live-updating **message** panel refreshed every ~30 s carrying the real-time numbers — message edits are far cheaper than channel renames.
- The bot occupies a locked voice channel (`@everyone` denied `Connect`) so it is visibly present.

**Staff stats category** — visible to staff only, richer panels: per-category occupancy, active mod counts, punishment volume, queue depth.

---

## 8. Logging

Consultant-only category, one channel per event family.

- **Gateway-first attribution** via `GuildAuditLogEntryCreate`, with polling fallback where the gateway is unreliable.
- **Counted-action handling.** For `MESSAGE_DELETE`, `MESSAGE_BULK_DELETE`, `MEMBER_MOVE`, `MEMBER_DISCONNECT`, Discord mutates an existing audit entry and increments `count` instead of creating a new one — so no gateway event fires for actions 2..N, and dedup-by-entry-ID silently drops them. We track `(entryId → lastSeenCount)` and emit the delta. **Critical here**, since moderators move people between voice channels constantly.
- **Self-suppression** via a pre-registered ignore list with a 15 s TTL, so the bot's own actions don't double-log.
- **Batching**: per-channel buffer, ~1 s flush, partitioned at 2000 chars.
- **Circuit breaker**: on error 50001/50013, put that channel on a 2-minute cooldown. Prevents a misconfigured channel burning the invalid-request budget.
- **Message retention** 24 h in Postgres, encrypted at rest, for edit/delete reconstruction. Attachment URLs rewritten to the non-expiring host form.

---

## 9. Leaderboards & activity

- Voice time tracked per session; AFK channel excluded, self-deafened and alone-in-channel time discounted.
- Message counts with anti-spam throttling.
- **Admin leaderboard** grouped by identity role: voice activity, message activity, punishments issued.
- Weekly automated post + `/leaderboard` on demand + always-live in the panel.
- **Daily (24 h)** top-voice and top-chatter banners, rendered via Satori.

---

## 10. Web panel — https://aion.neoxify.com

Next.js 16 App Router, Tailwind v4, shadcn/ui, dark-first, Vazirmatn + a Latin display face.

**Auth:** Discord OAuth2 → verify the user currently holds the gate role (`Consultant` or above) in the guild → signed session cookie. Role is re-checked server-side per request, so revoking the Discord role revokes panel access immediately.

**Sections:** Dashboard · Server Setup & Reconcile · Roles & Permissions · Moderation cases · Verification queue · TempVoice config · Leaderboards · Announcements · Live logs · Backups · Bot health.

**Realtime:** Postgres `LISTEN/NOTIFY` → SSE to the browser. Simpler than websockets and works cleanly behind Caddy.

**Announcements:** choose channel, choose mention targets (`@everyone` / specific roles), compose with live preview of exactly how it will render, send as the bot.

---

## 11. Persian / bidi correctness

Not cosmetic — it is the difference between looking professional and looking broken.

- Every interpolated value in Persian output is wrapped in `FSI…PDI` (`U+2068…U+2069`) so usernames and game titles can't reorder the sentence around them.
- `U+061C` (ALM) before digits adjacent to Persian — `RLM` does not work here, because Persian letters retarget following ASCII digits to Arabic-number class.
- `ي→ی`, `ك→ک` and Arabic-Indic digits normalised before any keyword matching, or Arabic-keyboard and Persian-keyboard users silently fail to match.
- **Never** put Persian prose in code blocks — monospace faces have poor Arabic coverage and no bidi isolation.
- Text channel names get lowercased with spaces→hyphens; **voice channel names keep spaces and casing**. Naming scheme exploits that asymmetry rather than fighting it.
- Bot copy is native Finglish — natural, not stiff, not overly formal.

---

## 12. Reconcile engine (mandatory — the server already exists)

A declarative manifest describes the desired guild: categories, channels, roles, colours, hierarchy, overwrites.

`/setup scan` (and the panel equivalent) diffs manifest against live guild and produces a **CREATE / UPDATE / SKIP** plan. It **never deletes** — extras are reported for a human to decide. The plan is shown for explicit approval before anything is applied, then executed through a rate-limit-aware queue. Re-running is a no-op.

It also watches `premiumTier` and applies boost-gated assets (banner, role icons, splash) automatically when Level 3 lands.

---

## 13. Backups & disaster recovery

Nightly cron: `pg_dump` + bot config + a JSON export of live guild structure → gzip → encrypt → email to panel-configured recipients, with the last N kept locally.

Recipients and schedule are editable in the panel. If a dump exceeds mail attachment limits it is split. **Recovery path:** fresh VPS → clone the GitHub repo → `install.sh` → restore the dump. That combination is the complete rebuild story.

---

## 14. Delivery phases

Each phase ends with something running on the server.

| # | Phase | Ships |
|---|---|---|
| 1 | Foundation | Repo, DB schema, bot skeleton, VPS provisioning, Caddy + TLS, CI tarball pipeline |
| 2 | Structure | Manifest + reconcile engine, role/category architecture applied to the live server |
| 3 | Moderation | `/punish`, scoped mute/ban/move, cases, cooldowns, ban channels |
| 4 | Verification | Gate, modal, admin queue, nickname styling |
| 5 | Logging | Full event coverage, audit attribution, batching, circuit breakers |
| 6 | Engagement | TempVoice, stats displays, leaderboards, Satori banners |
| 7 | Panel | Auth, all sections, live logs via SSE, announcements |
| 8 | Ops | Backups + email, docs, README, runbook |

---

## 15. Open items

- **Discord application** — created by the account owner; token written directly into the VPS `.env`, never pasted into chat.
- **SMTP credentials** for backup email (provider + from-address + recipients).
- **Existing category/channel names** — need the real current names to write the manifest's match rules.
- **Identity role naming language** — Persian or English labels for the six identity roles.
- **Brand assets** — icon, banner, splash, role icons, colour palette.
