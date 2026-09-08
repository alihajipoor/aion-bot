import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Defence in depth. Authorisation still happens in requireSession() — that is
 * what re-checks Discord roles — but this rejects anything under /dashboard
 * without a valid signed session before a page or action ever runs, so a future
 * route that forgets the check is not silently exposed.
 *
 * Runs on the Node runtime because it verifies the same JWT the app issues.
 */
export const runtime = 'nodejs';

const COOKIE = 'aion_session';

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(COOKIE)?.value;
  const deny = () => {
    const url = new URL('/', req.url);
    url.searchParams.set('error', 'forbidden');
    return NextResponse.redirect(url);
  };

  if (!token) return deny();

  const secret = process.env.PANEL_SESSION_SECRET;
  if (!secret) return deny();   // fail closed: no secret means nothing can be trusted

  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
  } catch {
    return deny();              // expired, tampered, or signed with another key
  }

  const res = NextResponse.next();
  // Panel pages carry live moderation data; never let a proxy or browser keep it.
  res.headers.set('Cache-Control', 'no-store, must-revalidate');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
