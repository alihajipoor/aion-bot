import type { NextConfig } from 'next';

const config: NextConfig = {
  // The VPS has 1.9 GB shared with two bots: ship a prebuilt standalone server
  // rather than ever running a build there.
  output: 'standalone',
  outputFileTracingRoot: process.cwd() + '/../..',
};
export default config;
