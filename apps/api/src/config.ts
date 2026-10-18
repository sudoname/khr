import * as dotenv from 'dotenv';
import * as path from 'path';

// Load repo-root .env first (monorepo layout), then any local overrides.
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('dev-only'))) {
  throw new Error('SESSION_SECRET must be set to a strong value in production');
}

export const config = {
  isProd,
  port: parseInt(process.env.API_PORT ?? '4000', 10),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6380',
  webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Base URL used in emails for links back to the web app. */
  webBaseUrl: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim(),
  secureCookies: process.env.SECURE_COOKIES === '1' || isProd,
  /**
   * Apex domain for per-company workspace subdomains (e.g. "khr.ng").
   * Unset in local dev — all subdomain behavior is disabled.
   */
  baseDomain: process.env.BASE_DOMAIN?.trim() || '',
  /** Cookie Domain attribute (e.g. ".khr.ng") so sessions span subdomains. */
  cookieDomain: process.env.COOKIE_DOMAIN?.trim() || '',
  sessionCookieName: 'pf_session',
  sessionTtlHours: 24 * 7,
  /** When enabled, privileged roles must enroll MFA before using tenant APIs. */
  enforceMfaForPrivileged: process.env.ENFORCE_MFA_FOR_PRIVILEGED === '1' || isProd,
  /** Google OAuth sign-in. Disabled unless both values are provided. */
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },
};
