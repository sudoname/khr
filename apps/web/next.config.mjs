/** @type {import('next').NextConfig} */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@peopleflow/types'],
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
