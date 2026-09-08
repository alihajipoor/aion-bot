import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { callBinary } from '@/lib/bot';

export const dynamic = 'force-dynamic';

const KINDS = new Set(['voice', 'chat', 'staff']);

/**
 * Proxies the bot's rendered banner. The bot binds to loopback, so the browser
 * can never reach it directly — and this way the image is behind the same
 * session check as every other page.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await requireSession();
  if (!session) return new NextResponse('unauthorised', { status: 401 });

  const { kind } = await params;
  if (!KINDS.has(kind)) return new NextResponse('unknown banner', { status: 404 });

  const buf = await callBinary(`/banner/preview?kind=${kind}`);
  if (!buf) return new NextResponse('the bot could not render this', { status: 503 });

  return new NextResponse(buf, {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=30' },
  });
}
