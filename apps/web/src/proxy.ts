import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const hasRefreshCookie = request.cookies.has('hktutor_refresh');
  const isDashboard = request.nextUrl.pathname.startsWith('/dashboard');

  if (isDashboard && !hasRefreshCookie) {
    const loginUrl = new URL('/', request.url);
    loginUrl.searchParams.set(
      'returnTo',
      `${request.nextUrl.pathname}${request.nextUrl.search}${request.nextUrl.hash}`,
    );
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/dashboard/:path*'],
};
