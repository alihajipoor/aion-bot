import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Two jobs, both on every page.
 *
 * The Content-Security-Policy. It used to be a fixed header in the Caddyfile,
 * with no script-src, so it fell back to default-src 'self' and blocked every
 * inline script. Next.js streams a page by sending its loading skeleton first
 * and swapping the real content in with an inline script — so from the day
 * that header went in (72cf2cf, 2026-09-08) every panel page sat on its
 * skeleton forever. Nobody noticed because only the guild owner could sign in
 * until 2026-10-13. The policy is now issued here with a fresh nonce per
 * request: Next stamps that nonce on its own scripts, and anything injected
 * without it is still refused. Everything else in the policy is unchanged.
 *
 * Defence in depth for /dashboard. Authorisation still happens in
 * requireSession() — that is what re-checks Discord roles — but this rejects
 * anything under /dashboard without a valid signed session before a page or
 * action ever runs, so a future route that forgets the check is not exposed.
 *
 * Runs on the Node runtime because it verifies the same JWT the app issues.
 */
export const runtime = 'nodejs';

const COOKIE = 'aion_session';

function policy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "img-src 'self' https://cdn.discordapp.com data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/dashboard')) {
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
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = policy(nonce);
  // Next reads the nonce from the request's policy header and applies it to its scripts.
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  if (req.nextUrl.pathname.startsWith('/dashboard')) {
    // Panel pages carry live moderation data; never let a proxy or browser keep it.
    res.headers.set('Cache-Control', 'no-store, must-revalidate');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return res;
}

export const config = {
  // Every page; not the static assets, images or API routes, which carry no inline script.
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico).*)' }],
};
