import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { clearSession } from '@/lib/auth';

export async function GET() {
  await clearSession();
  return NextResponse.redirect(env.baseUrl());
}
