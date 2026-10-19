import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

/**
 * Baseline security headers, set manually (no helmet dependency). The API
 * serves JSON only, so a restrictive framing/sniffing posture is safe; the
 * web app sets its own (richer) set via next.config.mjs headers().
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // frame-ancestors only: no default-src, so Swagger UI in dev keeps working.
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Default: API responses carry tenant data and must never be cached by
  // browsers or intermediaries. Routes that stream cacheable assets (logos,
  // photos) run after this middleware and override with their own value.
  res.setHeader('Cache-Control', 'private, no-store');
  if (config.isProd) {
    // Only meaningful over TLS; omitted in dev/test to avoid pinning localhost.
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
}
