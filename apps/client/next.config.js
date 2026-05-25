/** @type {import('next').NextConfig} */

const nextConfig = {
  experimental: {},
  output: 'standalone',
  serverExternalPackages: [],
  transpilePackages: ['@softsensor/database'],
  allowedDevOrigins:['10.51.6.41']
}

export default nextConfig
