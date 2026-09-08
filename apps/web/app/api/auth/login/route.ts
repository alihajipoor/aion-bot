import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

export const STATE_COOKIE = 'aion_oauth_state';

export async function GET() {
  // Without a state parameter an attacker can walk a victim's browser through
  // their own authorization code, which would misattribute every audit entry.
  const state = randomUUID();
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600,
  });

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', env.clientId());
  url.searchParams.set('redirect_uri', `${env.baseUrl()}/api/auth/callback/discord`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('prompt', 'none');
  url.searchParams.set('state', state);
  return NextResponse.redirect(url.toString());
}
