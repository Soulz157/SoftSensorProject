/** @type {import('next').NextConfig} */

const nextConfig = {
  experimental: {},
  output: 'standalone',
  serverExternalPackages: [],
  transpilePackages: ['@softsensor/database'],

}

export default nextConfig
