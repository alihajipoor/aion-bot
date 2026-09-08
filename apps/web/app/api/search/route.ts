import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getMembers } from '@/lib/bot';

export const dynamic = 'force-dynamic';

/**
 * Member lookup for the command palette. It goes through the bot rather than
 * shipping the roster to the browser, so the folding that makes styled
 * nicknames searchable lives in exactly one place.
 */
export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ members: [] }, { status: 401 });

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ members: [] });

  const data = await getMembers(q, 8);
  return NextResponse.json({
    members: (data?.members ?? []).map(m => ({
      id: m.id,
      name: m.nickname ?? m.username,
      sub: m.username,
      avatar: m.avatar,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
