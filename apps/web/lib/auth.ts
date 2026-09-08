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

/**
 * Role membership is read live from Discord with the bot token rather than
 * trusted from the OAuth response, so revoking someone's role in Discord
 * revokes their panel access immediately rather than at token expiry.
 */
export async function fetchMemberRoles(userId: string): Promise<string[] | null> {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${env.guildId()}/members/${userId}`,
    { headers: { Authorization: `Bot ${env.botToken()}` }, cache: 'no-store' },
  );
  if (!res.ok) return null;
  const member = await res.json() as { roles: string[] };

  const rolesRes = await fetch(
    `https://discord.com/api/v10/guilds/${env.guildId()}/roles`,
    { headers: { Authorization: `Bot ${env.botToken()}` }, cache: 'no-store' },
  );
  if (!rolesRes.ok) return null;
  const all = await rolesRes.json() as { id: string; name: string }[];
  const byId = new Map(all.map(r => [r.id, r.name]));
  return member.roles.map(id => byId.get(id)).filter((n): n is string => !!n);
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
  const res = await fetch(`https://discord.com/api/v10/guilds/${env.guildId()}`, {
    headers: { Authorization: `Bot ${env.botToken()}` }, cache: 'no-store',
  });
  if (!res.ok) return ownerId;
  const guild = await res.json() as { owner_id: string };
  ownerId = guild.owner_id;
  ownerFetchedAt = Date.now();
  return ownerId;
}

/** Gate check: a listed role, or the server owner. */
export async function canAccess(userId: string, roles: string[]): Promise<boolean> {
  return isAllowed(roles) || userId === await guildOwnerId();
}

/** Re-checks Discord on every request; returns null when access is revoked. */
export async function requireSession(): Promise<Session | null> {
  const session = await readSession();
  if (!session) return null;
  const roles = await fetchMemberRoles(session.id);
  if (!roles) return null;
  if (!await canAccess(session.id, roles)) return null;
  return { ...session, roles };
}
