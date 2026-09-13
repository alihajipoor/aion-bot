# Role icons

Two ways to get icons onto the roles.

## Use a pack you like

Drop one image per role into a folder, named after the slug below, then:

```bash
node tools/setup/roleicons.mjs --from ./my-pack          # dry run
node tools/setup/roleicons.mjs --from ./my-pack --apply
```

PNG, JPEG and GIF all work, and files are uploaded exactly as they are —
nothing is redrawn. A pack from emoji.gg or an illustrator arrives as its
author made it. Any role with no matching file is left alone, so a partial
pack is fine.

| file | role |
|---|---|
| `dev.png` | ᴅᴇᴠ│• |
| `consultant.png` | ᴄᴏɴsᴜʟᴛᴀɴᴛ│• |
| `poweradmin.png` | ᴘᴏᴡᴇʀᴀᴅᴍɪɴ│• |
| `mansion-key.png` | ᴍᴀɴsɪᴏɴ│𝙺𝙴𝚈│• |
| `v-global.png` `p-global.png` `g-global.png` `e-global.png` | the Globals |
| `p-moderator.png` `g-moderator.png` `e-moderator.png` | the Moderators |
| `server-banned.png` `public-banned.png` `game-banned.png` `event-banned.png` | bans |
| `public-muted.png` `game-muted.png` `entertainment-muted.png` | mutes |
| `music-robot.png` | ᴀ ɪ ᴏ ɴ │𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃│• |
| `boy-member.png` `girl-member.png` | the member roles |

**Two constraints worth knowing before you pick artwork.** Discord caps a role
icon at 256 KB, and it draws them at roughly 20px beside a name — so detail
that looks good on the source file often disappears entirely. Check a pack
small before committing to it.

## Or generate the built-in set

```bash
ICON_OUT=assets/role-icons node tools/setup/roleicons.mjs
```

Writes the PNGs here plus `contact-sheet.png`, which shows every icon at drawn
size and again at the size Discord actually renders. Add `--apply` to upload.
