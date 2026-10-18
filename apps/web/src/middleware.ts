import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Workspace-subdomain routing. No-op unless NEXT_PUBLIC_BASE_DOMAIN is set
 * (local dev stays untouched).
 *
 * - Strips any client-supplied `x-workspace-slug` header (anti-spoof): only
 *   this middleware may assert the workspace, derived from the Host header.
 * - 308s `www.<base>` to the apex.
 * - On `<slug>.<base>` hosts, injects `x-workspace-slug: <slug>` into the
 *   request. The header survives the `/api/:path*` rewrite to the API, where
 *   AuthGuard pins the tenant to the workspace.
 */

const BASE_DOMAIN = (process.env.NEXT_PUBLIC_BASE_DOMAIN ?? '').toLowerCase();
// Keep in sync with SLUG_RE in @peopleflow/types (inlined: middleware runs on
// the edge runtime and must stay dependency-free).
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.delete('x-workspace-slug');

  if (!BASE_DOMAIN) return NextResponse.next({ request: { headers } });

  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();

  if (host === `www.${BASE_DOMAIN}`) {
    const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${BASE_DOMAIN}`);
    return NextResponse.redirect(url, 308);
  }

  if (host !== BASE_DOMAIN && host.endsWith(`.${BASE_DOMAIN}`)) {
    const slug = host.slice(0, -(BASE_DOMAIN.length + 1));
    if (SLUG_RE.test(slug)) headers.set('x-workspace-slug', slug);
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except Next static assets; must include /api so the injected
  // header reaches the API through the rewrite.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
