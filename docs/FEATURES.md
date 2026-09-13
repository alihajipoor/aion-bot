# AION — bot replacement & feature spec

Goal: one bot replaces all six. **Only the music bots stay** (Jockie Music, SoundCloud).

## 1. Replacement matrix

| Bot today | What it does for AION | AION module | Phase |
|---|---|---|---|
| **Carl-bot** *(nick `A I O N - V E R I F Y`)* | verification, reaction roles, automod, logging, tags, starboard, suggestions | Verification · SelfRoles · AutoMod · Logging · Tags | 4, 5 |
| **ServerStats** | the `A I O N • n` / `M I C • n` counter channels | LiveCounters | 6 |
| **Statbot** | voice-time + message analytics, leaderboards | Activity · Leaderboards | 6 |
| **Invite Tracker** | who invited whom, invite leaderboard | InviteTracking | 5 |
| **AutoReacter** | automatic reactions on posts | AutoReact | 5 |
| **ProBot** | welcome images, levelling, moderation, automod | Welcome · Levelling · Moderation | 3, 4, 6 |
| ~~Wick~~ | anti-nuke / anti-raid *(bot not actually present — role was leftover)* | AntiNuke · AntiRaid | 5 |
| **Jockie Music / SoundCloud** | music | **keep — not replaced** | — |

## 2. Logging

### 2a. The 20 channels that exist today — all preserved

`ᴊᴏɪɴ` `ʟᴇᴀᴠᴇ` `ɪɴᴠɪᴛᴇ` `ʙᴀɴ-ᴜɴʙᴀɴ` `ᴋɪᴄᴋᴇᴅ` `ʀᴏʟᴇ-ᴄʀᴇᴀᴛᴇᴅ` `ʀᴏʟᴇ-ᴅᴇʟᴇᴛᴇᴅ` `ʀᴏʟᴇ-ᴜᴘᴅᴀᴛᴇᴅ`
`ᴄʜᴀɴɴᴇʟ-ᴄʀᴇᴀᴛᴇᴅ` `ᴄʜᴀɴɴᴇʟ-ᴅᴇʟᴇᴛᴇᴅ` `ᴄʜᴀɴɴᴇʟ-ᴜᴘᴅᴀᴛᴇᴅ` `ᴊᴏɪɴᴇᴅ-ᴠᴏɪᴄᴇ` `ʟᴇꜰᴛ-ᴠᴏɪᴄᴇ` `ꜱᴡɪᴛᴄʜᴇᴅ-ᴠᴏɪᴄᴇ`
`ᴠᴏɪᴄᴇ-ꜱᴛᴀᴛᴇ` `ᴍᴇᴍʙᴇʀ-ᴜᴘᴅᴀᴛᴇ` `ᴛɪᴍᴇᴏᴜᴛ` `ʙᴏᴏꜱᴛ` `ᴍᴇꜱꜱᴀɢᴇ-ꜱᴛᴀᴛᴇ` `ʟᴏɢ-ᴛɪᴄᴋᴇᴛ`
Plus `LOG admins`: `ᴀᴅᴍɪɴ-ᴀᴄᴛɪᴠᴇ`, `ʙᴀɴɴᴇᴅ-ʟᴏɢ`.

Routing is configurable per event in the web panel — channels are not hard-coded.

### 2b. What none of the current bots log — the real upgrade

- **Permission overwrite changes** (`ChannelOverwriteCreate/Update/Delete`). The single most important gap: this server's entire security model *is* overwrites. If someone quietly grants themselves `ViewChannel` on a ban channel, nothing today would tell you.
- **Webhook / integration / bot-add events** — the classic server-nuke vector.
- **Which invite each member used** — requires `ManageGuild` plus invite-cache diffing on every join.
- **Nickname vs global-username split** — currently collapsed into one "member update".
- **Avatar changes**, camera / Go Live / stream state, stage instances.
- **Thread lifecycle** — create, archive, lock, auto-archive changes.
- **AutoMod** rule edits *and* action executions.
- **Guild settings** — name, icon, vanity URL, verification level, owner transfer.
- **Scheduled events**, message pin/unpin, poll votes, soundboard, emoji/sticker CRUD.
- **Bulk deletes archived off-Discord** with a link — 500 deleted messages cannot fit in one Discord message.

### 2c. Correctness details that make it trustworthy

- **Gateway-first attribution** via `GuildAuditLogEntryCreate`, with polling fallback.
- **The counted-action fix.** For `MESSAGE_DELETE`, `MESSAGE_BULK_DELETE`, `MEMBER_MOVE` and `MEMBER_DISCONNECT`, Discord *mutates* an existing audit entry and increments `count` rather than creating a new one — so no gateway event fires for actions 2..N, and naive dedup-by-entry-id silently drops them. We track `(entryId → lastSeenCount)` and emit the delta. **Critical here**, since moderators move people between voice channels constantly.
- **Self-suppression** via a pre-registered ignore list with a 15 s TTL, so AION's own actions never double-log.
- **Batching** — per-channel buffer, ~1 s flush, partitioned at 2000 chars, so a raid produces ~1 message/sec instead of 40.
- **Circuit breaker** — on error 50001/50013 a channel goes on a 2-minute cooldown. Without this, one broken channel burns the 10k-invalid-requests-per-10-min budget and gets the whole bot IP-banned.
- **Message retention** 24 h in Postgres, encrypted at rest, for edit/delete reconstruction. Attachment URLs rewritten to the non-expiring form.

## 3. Module detail

**Verification** (replaces Carl-bot) — button → modal (name, age, city, gender) → approval queue in `𝙰𝙳𝙼𝙸𝙽-𝚅𝙴𝚁𝙸𝙵𝚈` → approve assigns `ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•` / `ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•` and applies the styled nickname; decline asks for a reason and shows it only to that user. Audit trail to `ʟᴏɢ-ᴠᴇʀɪꜰʏ`.

**LiveCounters** (replaces ServerStats) — `A I O N • n` and `M I C • n`. Hard limit: 2 channel renames per 10 min per channel, so counters refresh on a ~6 min stagger; the truly live numbers go in an edited message (~30 s) and the panel.

**Activity + Leaderboards** (replaces Statbot) — voice sessions excluding AFK, discounting self-deafened and alone-in-channel time; message counts with anti-spam. Weekly admin leaderboard by role, daily top-voice/top-chatter banners rendered with Satori so they share the panel's design system.

**InviteTracking** (replaces Invite Tracker) — invite cache diffed on each join, with vanity-URL and OAuth fallbacks. Links minted by the giveaway's button carry recorded ownership, which beats the diff: those joins are attributed exactly rather than inferred.

**Giveaway** — invite competition with a scorer strict enough to hang a prize on: one credit per person ever, a minimum account age, verification required. `/giveaway man` shows anyone their own invitees with a reason beside each that did not count, and `/giveaway review` reports the health of the ledger before anyone is paid. The rules are pure functions under test (`apps/bot/test/`), and CI runs them on every deploy. Full detail in [GIVEAWAY.md](GIVEAWAY.md).

**AntiNuke / AntiRaid** (replaces Wick) — thresholds on mass channel/role delete, mass ban/kick, webhook creation and rapid joins; automatic response (strip roles / lockdown) plus alerting.

**Moderation** — `/punish` with category-scoped bans, the scoped mute/ban roles, 10 s Global cooldown, case IDs, and the per-section `𝙿𝚄𝙽𝙸𝚂𝙷𝙼𝙴𝙽𝚃` / `𝙱𝙰𝙽-𝚂𝙴𝙲𝚃𝙸𝙾𝙽` channel gating.

## 4. Known issues to fix in later phases

- **`• 𝗣𝗥𝗜𝗩𝗔𝗧𝗘` is invisible to members** (0/1 channels visible). The `🅟 ─ PRIVET DRIVE` join-to-create hub must be visible for TempVoice to work — fix in Phase 6.
- **`tarashun` holds both boy and girl roles** — needs a human decision.
- **Bot token was pasted in chat** — rotate before go-live and keep the new one only on the VPS.
