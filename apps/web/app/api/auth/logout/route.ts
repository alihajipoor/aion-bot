import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { clearSession } from '@/lib/auth';

/** POST only: a GET here lets any page log a user out with an <img> tag. */
export async function POST() {
  await clearSession();
  return NextResponse.redirect(env.baseUrl(), { status: 303 });
}
