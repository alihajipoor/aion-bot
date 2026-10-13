import type { NextConfig } from 'next';

const config: NextConfig = {
  // The VPS has 1.9 GB shared with two bots: ship a prebuilt standalone server
  // rather than ever running a build there.
  output: 'standalone',
  outputFileTracingRoot: process.cwd() + '/../..',
  // Shop product pictures are uploaded through a server action; the default 1 MB
  // cap is too small for a phone photo. The bot shrinks them to 192px anyway.
  experimental: { serverActions: { bodySizeLimit: '9mb' } },
};
export default config;
