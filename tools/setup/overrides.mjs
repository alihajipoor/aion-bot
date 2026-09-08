// Deliberate deviations from the reference server.
// The reference is the structural source of truth; this file is where we
// correct its gaps instead of replicating them.

export const RENAME = {                 // reference name -> corrected name
  'bansection': 'ban-section',
  'adminacitve': 'admin-active',
};

// Roles the reference is missing entirely. `after` = place directly below that role.
export const EXTRA_ROLES = [
  { name: 'E . MODERATOR', color: '#000000', hoist: false, after: 'P . MODERATOR',
    reason: 'Entertainment had a Global tier but no Moderator tier' },
  { name: 'Game Banned',   color: '#ff0000', hoist: false, after: 'Public Banned',
    reason: 'GameTown had no category ban role' },
];

// Channels the reference is missing. Keyed by category name.
export const EXTRA_CHANNELS = {
  '• 𝗤𝗨𝗜𝗗𝗗𝗜𝗧𝗖𝗛 ⎯⎯⎯⎯⎯⎯╮': [
    { name: 'admin-chat',  type: 'GuildText',  staffOnly: true },
    { name: 'punishment',  type: 'GuildText',  staffOnly: true },
    { name: 'ban-section', type: 'GuildText',  staffOnly: true },
    { name: '🅔├ Esm Famil │📝',           type: 'GuildVoice' },
    { name: '🅔├ Mafia │🕵️',               type: 'GuildVoice' },
    { name: '🅔├ 20 Soali │❓',            type: 'GuildVoice' },
    { name: '🅔├ Jorat ya Haghighat │🎭',  type: 'GuildVoice' },
    { name: '🅔├ Sandali Dagh │🔥',        type: 'GuildVoice' },
    { name: '🅔└ Stream Voice │📺',        type: 'GuildVoice' },
  ],
};

// Reference channels to skip (superseded by a styled EXTRA_CHANNELS entry).
export const SKIP_REFERENCE_CHANNELS = new Set(['stream voice']);

// Approved security fixes on the LIVE server.
export const STRIP_ALL_PERMS = [
  '⠂ ⎯⎯⎯⎯⎯⏋',          // decorative divider that carried Administrator
];
export const STRIP_PERMS = {            // role -> permissions to remove
  'P . Global':    ['ManageRoles', 'ViewAuditLog'],
  'E . Global':    ['ManageRoles'],
  'P . MODERATOR': ['ViewAuditLog'],
  'Bax Mighty':    ['ViewAuditLog'],
};
// Guild-level perms that CANNOT be expressed as a channel overwrite —
// left alone deliberately, reported rather than silently removed.
export const UNSCOPEABLE_NOTE = ['ManageNicknames', 'ViewAuditLog'];

// Overwrites we must NOT copy from the reference onto the live server.
// The reference is wrong here; live is right.
export const PROTECT_OVERWRITES = [
  { category: '• 𝗩𝗘𝗥𝗜𝗙𝗬 ⎯⎯⎯⎯⎯⎯╮', role: '@everyone',
    why: 'reference denies ViewChannel — that would make verification unreachable for new members' },
];

// Channels whose names contain live-updating counters. Matched by pattern, not
// exact name, otherwise every sync would create a duplicate.
export const DYNAMIC_CHANNELS = [
  /^a i o n\s*[•·]/i,
  /^m i c\s*[•·]/i,
];

// ── Approved removals ────────────────────────────────────────────────
// Deleted from live AND never re-created from the reference.
export const DELETE_ROLE_PATTERNS = [/^ᶜᵒˡᵒʳ│/, /^⠂ColoR/];
export const DELETE_ROLES    = ['Wick', 'Quarantine', 'ᴀ ɪ ᴏ ɴ Prime',
  // replaced by the gendered member roles; must never come back from the reference
  'ᴀ ɪ ᴏ ɴ │𝙼𝙴𝙼𝙱𝙴𝚁│•'];
export const DELETE_CHANNELS = ['wow', '│💦│ᴍ', '│💢│ʜɪᴅᴇ', 'booby'];
export const DELETE_CATEGORIES = ['kiri kari'];
// Never create these from the reference, even though it has them.
export const isExcludedRole = (name) =>
  DELETE_ROLE_PATTERNS.some(r => r.test(name)) || DELETE_ROLES.includes(name);

// ── Channel typography ───────────────────────────────────────────────
// The reference names these plainly; the server's convention is monospace
// capitals for section text channels and small-caps for log channels.
// NFKC-normalised matching means styled and plain names still compare equal,
// so renaming never produces duplicates.
export const STYLE = {
  'admin-chat':    '•︱🛡│𝙰𝙳𝙼𝙸𝙽-𝙲𝙷𝙰𝚃',
  'punishment':    '•︱⚖│𝙿𝚄𝙽𝙸𝚂𝙷𝙼𝙴𝙽𝚃',
  'ban-section':   '•︱⛔│𝙱𝙰𝙽-𝚂𝙴𝙲𝚃𝙸𝙾𝙽',
  'bansection':    '•︱⛔│𝙱𝙰𝙽-𝚂𝙴𝙲𝚃𝙸𝙾𝙽',
  'admin-verify':  '•︱🛡│𝙰𝙳𝙼𝙸𝙽-𝚅𝙴𝚁𝙸𝙵𝚈',
  'log-verify':    '•︱📋│𝙻𝙾𝙶-𝚅𝙴𝚁𝙸𝙵𝚈',
  'top-active':    '•︱🏆│𝚃𝙾𝙿-𝙰𝙲𝚃𝙸𝚅𝙴',
  'admin-active':  '│📊│ᴀᴅᴍɪɴ-ᴀᴄᴛɪᴠᴇ',
  'adminacitve':   '│📊│ᴀᴅᴍɪɴ-ᴀᴄᴛɪᴠᴇ',
  'banned-logbot': '│⛔│ʙᴀɴɴᴇᴅ-ʟᴏɢ',
};
Object.assign(RENAME, STYLE);
