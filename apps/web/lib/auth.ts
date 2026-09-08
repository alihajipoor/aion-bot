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

/** Re-checks Discord on every request; returns null when access is revoked. */
export async function requireSession(): Promise<Session | null> {
  const session = await readSession();
  if (!session) return null;
  const roles = await fetchMemberRoles(session.id);
  if (!roles || !isAllowed(roles)) return null;
  return { ...session, roles };
}
