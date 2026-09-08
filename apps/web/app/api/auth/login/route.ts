import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export function GET() {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', env.clientId());
  url.searchParams.set('redirect_uri', `${env.baseUrl()}/api/auth/callback/discord`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('prompt', 'none');
  return NextResponse.redirect(url.toString());
}
