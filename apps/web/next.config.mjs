/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@morphic/db', '@morphic/shared'],
  output: 'standalone',
};

export default nextConfig;
