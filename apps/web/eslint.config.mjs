import nextConfig from 'eslint-config-next';

export default [...nextConfig, { ignores: ['.next/**', 'next-env.d.ts'] }];
