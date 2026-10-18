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
};

export default nextConfig;
