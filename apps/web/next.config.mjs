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
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // Strips console.log/info/debug in production. The transform also runs on server code, so
  // error/warn stay: they are the server's diagnostics (DB read failures, auth retries).
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  output: process.env.VERCEL || process.env.NETLIFY ? undefined : 'standalone',
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
        // Enforced. Every browser fetch is same-origin (/api/backend proxies the gateway), so the
        // only third parties are reCAPTCHA, the PayPal JS SDK and Google Fonts (root layout). 'unsafe-inline' stays for
        // Next's inline bootstrap (no nonces); 'unsafe-eval' only in dev for React Refresh.
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"} https://www.google.com https://www.gstatic.com https://www.paypal.com https://www.sandbox.paypal.com`,
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data: https://fonts.gstatic.com https://www.paypalobjects.com",
            "connect-src 'self' https://www.google.com https://www.paypal.com https://www.sandbox.paypal.com https://*.paypal.com",
            "frame-src https://www.google.com https://www.paypal.com https://www.sandbox.paypal.com",
            "object-src 'none'",
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
