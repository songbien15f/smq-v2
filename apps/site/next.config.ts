import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@sq/ui', '@sq/contracts'],
};

export default nextConfig;
