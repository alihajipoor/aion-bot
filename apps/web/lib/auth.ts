import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { env, GATE_ROLES } from './env';

const COOKIE = 'aion_session';
const MAX_AGE = 60 * 60 * 8;   // 8 hours

export interface Session {
  id: string;
  username: string;
  avatar: string | null;
  roles: string[];
  /** Captured at login so the owner check never depends on a live API call. */
  owner?: boolean;
}

const key = () => new TextEncoder().encode(env.sessionSecret());

export async function createSession(s: Session): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/* ── live role lookups, lightly cached ────────────────────────── */

type Roles = { id: string; name: string }[];
let roleList: Roles | null = null;
let roleListAt = 0;
const ROLE_LIST_TTL = 5 * 60_000;      // the role list barely changes
const MEMBER_TTL = 15_000;             // short: revocation must still be quick

const memberCache = new Map<string, { roles: string[]; at: number }>();

class DiscordUnavailable extends Error {}

async function discord(path: string): Promise<Response> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${env.botToken()}` },
    cache: 'no-store',
  });
  // 5xx and 429 mean "ask again later", not "this person lost access".
  if (res.status >= 500 || res.status === 429) throw new DiscordUnavailable(String(res.status));
  return res;
}

async function guildRoles(): Promise<Roles> {
  if (roleList && Date.now() - roleListAt < ROLE_LIST_TTL) return roleList;
  const res = await discord(`/guilds/${env.guildId()}/roles`);
  if (!res.ok) throw new DiscordUnavailable(String(res.status));
  roleList = await res.json() as Roles;
  roleListAt = Date.now();
  return roleList;
}

/**
 * Read from Discord rather than trusting the session, so removing a role
 * revokes panel access on the next request instead of at token expiry.
 * Throws when Discord itself is unavailable, so a transient outage is not
 * mistaken for a revoked role.
 */
export async function fetchMemberRoles(userId: string): Promise<string[] | null> {
  const hit = memberCache.get(userId);
  if (hit && Date.now() - hit.at < MEMBER_TTL) return hit.roles;

  const res = await discord(`/guilds/${env.guildId()}/members/${userId}`);
  if (res.status === 404) return null;            // genuinely not a member
  if (!res.ok) throw new DiscordUnavailable(String(res.status));

  const member = await res.json() as { roles: string[] };
  const byId = new Map((await guildRoles()).map(r => [r.id, r.name]));
  const names = member.roles.map(id => byId.get(id)).filter((n): n is string => !!n);
  memberCache.set(userId, { roles: names, at: Date.now() });
  return names;
}

export const isAllowed = (roles: string[]): boolean =>
  roles.some(r => GATE_ROLES.includes(r));

let ownerId: string | null = null;
let ownerFetchedAt = 0;

/**
 * The server owner always has access. They can grant themselves any role in
 * Discord anyway, so gating them out protects nothing -- it just locks the one
 * person who cannot be locked out of the server itself out of its panel.
 */
async function guildOwnerId(): Promise<string | null> {
  if (ownerId && Date.now() - ownerFetchedAt < 300_000) return ownerId;
  const res = await discord(`/guilds/${env.guildId()}`);
  if (!res.ok) return ownerId;
  const guild = await res.json() as { owner_id: string };
  ownerId = guild.owner_id;
  ownerFetchedAt = Date.now();
  return ownerId;
}

export async function isGuildOwner(userId: string): Promise<boolean> {
  try { return userId === await guildOwnerId(); } catch { return false; }
}

/** Gate check: a listed role, or the server owner. */
export async function canAccess(userId: string, roles: string[]): Promise<boolean> {
  return isAllowed(roles) || userId === await guildOwnerId();
}

/**
 * Re-checks Discord on every request; returns null when access is revoked.
 * If Discord is unreachable we fall back to the roles captured at login rather
 * than signing the person out mid-action — a transient API failure is not the
 * same as losing a role.
 */
export async function requireSession(): Promise<Session | null> {
  const session = await readSession();
  if (!session) {
    console.warn('[auth] no valid session cookie');
    return null;
  }

  // Owner status is captured at login so a failed API call cannot log them out
  // mid-action, but it is still re-verified on a cached cadence so a transferred
  // ownership does not leave the old owner with access for the whole token life.
  if (session.owner) {
    try {
      if (session.id === await guildOwnerId()) return session;
      console.warn(`[auth] ${session.username} is no longer the guild owner`);
    } catch {
      return session;   // Discord unavailable: trust the signed claim
    }
  }

  try {
    const roles = await fetchMemberRoles(session.id);
    if (!roles) { console.warn(`[auth] ${session.username} is no longer a guild member`); return null; }
    if (!isAllowed(roles)) { console.warn(`[auth] ${session.username} holds no gate role: ${roles.join(', ')}`); return null; }
    return { ...session, roles };
  } catch (e) {
    // Discord unavailable is not the same as access revoked.
    console.warn(`[auth] role check failed for ${session.username}, falling back to session roles:`, (e as Error).message);
    return isAllowed(session.roles) ? session : null;
  }
}
