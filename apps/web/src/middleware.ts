import { NextResponse, type NextRequest } from 'next/server';

/** Sign-in flows. A signed-in visitor is bounced off these to the dashboard. */
const AUTH_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
];

/**
 * Pages that are open to everyone, signed in or not.
 *
 * The public tools are the top of the acquisition funnel: they must work for an
 * anonymous visitor arriving from Google, and they must keep working for a
 * customer who happens to be signed in. Redirecting either way would break the
 * pages we are asking Google to rank.
 */
const OPEN_PATHS = ['/tools', '/legal'];

const SESSION_COOKIE = process.env.COOKIE_NAME ?? 'ip_session';

function matches(pathname: string, paths: string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Edge-level routing only.
 *
 * The cookie's *presence* decides which shell to render; it is never treated as
 * proof of identity. Every protected read and write is authorised again by the
 * API against the session record.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (matches(pathname, OPEN_PATHS)) return NextResponse.next();

  const isAuthPage = matches(pathname, AUTH_PATHS);

  if (!hasSession && !isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (hasSession && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
