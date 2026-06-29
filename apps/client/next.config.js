/** @type {import('next').NextConfig} */

const nextConfig = {
  experimental: {},
  output: 'standalone',
  serverExternalPackages: [],
  transpilePackages: ['@softsensor/database'],
  allowedDevOrigins: ['10.51.4.29'],
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '4000',
        pathname: '/**',
      },
    ],
  },
}

export default nextConfig
