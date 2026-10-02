import fs from 'node:fs';
import path from 'node:path';

// Load monorepo root .env if not already present
const rootEnv = path.resolve(process.cwd(), '../../.env');
if (fs.existsSync(rootEnv) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(rootEnv);
  } catch (e) {
    console.warn('[next.config.mjs] Failed to load root .env:', e);
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@morphic/db', '@morphic/shared'],
  // 'standalone' is for self-hosting / Docker. On Vercel it breaks the build adapter
  // (missing next-server.js.nft.json), so let Vercel use its native output there.
  output: process.env.VERCEL ? undefined : 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
        },
        // Report-only first: Next's inline bootstrap and framer-motion need verification
        // before this is enforced. Tighten to enforcing CSP once report noise is clear.
        {
          key: 'Content-Security-Policy-Report-Only',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://www.google.com https://www.gstatic.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "connect-src 'self'",
            "frame-src https://www.google.com https://www.paypal.com https://www.sandbox.paypal.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
        },
        ...(process.env.NODE_ENV === 'production'
          ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
          : []),
      ],
    },
  ],
};

export default nextConfig;
