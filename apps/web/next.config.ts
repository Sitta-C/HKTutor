import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const internalApiUrl = (process.env.API_INTERNAL_URL ?? 'http://localhost:3001').replace(
  /\/+$/,
  '',
);

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(webRoot, '../..'),
  reactCompiler: true,
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${internalApiUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
