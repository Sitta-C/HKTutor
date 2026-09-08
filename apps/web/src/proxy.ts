import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const hasRefreshCookie = request.cookies.has('hktutor_refresh');
  const isDashboard = request.nextUrl.pathname.startsWith('/dashboard');

  if (isDashboard && !hasRefreshCookie) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/dashboard/:path*'],
};
