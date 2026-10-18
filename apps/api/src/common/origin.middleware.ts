import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * True when an Origin header value is trusted: an exact WEB_ORIGIN match, or —
 * when workspace subdomains are enabled — any https origin on the base domain
 * (`https://khr.ng`, `https://<slug>.khr.ng`).
 */
export function originAllowed(origin: string): boolean {
  if (config.webOrigins.includes(origin)) return true;
  if (!config.baseDomain) return false;
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'https:' &&
      (url.hostname === config.baseDomain || url.hostname.endsWith(`.${config.baseDomain}`))
    );
  } catch {
    return false;
  }
}

/**
 * CSRF defense-in-depth: session cookies are SameSite=Lax (primary defense);
 * additionally, browser-initiated mutations must come from an allowed origin.
 * Requests without an Origin header (same-origin fetches in some agents,
 * non-browser clients) are allowed — they cannot carry a victim's SameSite=Lax
 * cookie cross-site.
 */
export function originCheck(req: Request, res: Response, next: NextFunction) {
  if (MUTATING.has(req.method)) {
    const origin = req.headers.origin;
    if (origin && !originAllowed(origin)) {
      res.status(403).json({ message: 'Cross-origin request rejected' });
      return;
    }
  }
  next();
}
