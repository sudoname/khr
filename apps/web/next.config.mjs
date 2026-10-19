/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

// Baseline security headers for every response. HSTS is harmless on plain
// http (browsers ignore it off TLS) so it is set unconditionally. The CSP
// enforced here only blocks framing; a fuller policy ships report-only until
// its fit with Next's inline bootstrap scripts is confirmed in the wild.
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy-Report-Only',
    value: "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'",
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server bundle so the production image ships only the
  // traced files (no pnpm, no full node_modules) and can run read-only.
  output: 'standalone',
  transpilePackages: ['@peopleflow/types'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Authenticated (app) route group: pages render tenant data and must
        // not land in any shared or disk cache. Marketing/auth pages and
        // /_next/static keep Next's default caching.
        source:
          '/:section(account|attendance|dashboard|documents|leave|onboarding|org|payroll|people|performance|platform|profile|recruitment|reports|settings|training)/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
  async rewrites() {
    // Proxy API calls through the web origin so the session cookie is
    // first-party and SameSite=Lax works without cross-site concessions.
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
  },
  async redirects() {
    // Swagger UI is served by the API and reachable through the proxy at
    // /api/docs; keep the advertised short path working.
    return [{ source: '/docs', destination: '/api/docs', permanent: false }];
  },
};

export default nextConfig;
