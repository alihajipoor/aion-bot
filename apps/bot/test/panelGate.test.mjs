// The web panel's gate and the bot agree on what a styled role name means.
//
// Both use foldRole from @aion/db. When the roles were restyled into the server
// font on 2026-09-10 the panel kept an exact match against "Dev", and every Dev
// and Consultant was locked out of it until 2026-10-13. These are the names the
// server actually uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldRole } from '@aion/db';

const GATE = new Set(['Consultant', 'Dev'].map(foldRole));
const allowed = (roles) => roles.some(r => GATE.has(foldRole(r)));

test('the styled Dev and Consultant roles open the panel', () => {
  assert.equal(allowed(['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'Server Booster', 'ᴅᴇᴠ│•']), true);
  assert.equal(allowed(['ᴄᴏɴsᴜʟᴛᴀɴᴛ│•']), true);
  assert.equal(allowed(['Dev']), true);    // and the plain spelling still works
});

test('nobody else gets in: members, boosters, PowerAdmin, moderators', () => {
  assert.equal(allowed(['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'Server Booster']), false);
  assert.equal(allowed(['ᴘᴏᴡᴇʀᴀᴅᴍɪɴ│•']), false);
  assert.equal(allowed(['ᴘ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•', 'ᴠ│𝙶𝙻𝙾𝙱𝙰𝙻│•']), false);
  assert.equal(allowed(['ᴅᴇᴠᴇʟᴏᴘᴇʀ fan club']), false);   // a role containing "dev" is not Dev
});
