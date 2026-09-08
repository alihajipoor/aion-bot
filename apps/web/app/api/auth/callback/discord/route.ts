import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { STATE_COOKIE } from '../../login/route';
import { env } from '@/lib/env';
import { createSession, setSessionCookie, fetchMemberRoles, canAccess, isGuildOwner } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.redirect(`${env.baseUrl()}/?error=nocode`);

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value ?? '';
  const given = req.nextUrl.searchParams.get('state') ?? '';
  jar.delete(STATE_COOKIE);
  const sameLength = expected.length > 0 && expected.length === given.length;
  if (!sameLength || !timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
    return NextResponse.redirect(`${env.baseUrl()}/?error=state`);
  }

  const token = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.clientId(),
      client_secret: env.clientSecret(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${env.baseUrl()}/api/auth/callback/discord`,
    }),
  });
  if (!token.ok) return NextResponse.redirect(`${env.baseUrl()}/?error=token`);
  const { access_token } = await token.json() as { access_token: string };

  const me = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!me.ok) return NextResponse.redirect(`${env.baseUrl()}/?error=user`);
  const user = await me.json() as { id: string; username: string; avatar: string | null };

  // Authorisation comes from the live guild roles, never from the OAuth scope.
  const roles = await fetchMemberRoles(user.id);
  if (!roles) return NextResponse.redirect(`${env.baseUrl()}/?error=notmember`);
  if (!await canAccess(user.id, roles)) return NextResponse.redirect(`${env.baseUrl()}/?error=forbidden`);

  await setSessionCookie(await createSession({
    id: user.id, username: user.username, avatar: user.avatar, roles,
    owner: await isGuildOwner(user.id),
  }));
  return NextResponse.redirect(`${env.baseUrl()}/dashboard`);
}
