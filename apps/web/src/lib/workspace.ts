/** Helpers for per-company workspace subdomains. All no-ops in local dev. */

export const BASE_DOMAIN = (process.env.NEXT_PUBLIC_BASE_DOMAIN ?? '').toLowerCase();

/** The workspace slug of the current host, or null on the apex / local dev. */
export function getCurrentSlug(): string | null {
  if (!BASE_DOMAIN || typeof window === 'undefined') return null;
  const host = window.location.hostname.toLowerCase();
  if (host === BASE_DOMAIN || !host.endsWith(`.${BASE_DOMAIN}`)) return null;
  const slug = host.slice(0, -(BASE_DOMAIN.length + 1));
  return slug && slug !== 'www' && !slug.includes('.') ? slug : null;
}

export function workspaceUrl(slug: string, path = '/dashboard'): string {
  return `https://${slug}.${BASE_DOMAIN}${path}`;
}

export function apexUrl(path = '/'): string {
  return `https://${BASE_DOMAIN}${path}`;
}
