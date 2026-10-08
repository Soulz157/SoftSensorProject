/** @type {import('next').NextConfig} */

const nextConfig = {
  experimental: {},
  output: 'standalone',
  serverExternalPackages: [],
  transpilePackages: ['@softsensor/database'],
  allowedDevOrigins: ['10.51.4.29'],
  async redirects() {
    return [
      {
        // Model Monitoring moved onto the Model detail page's Monitoring
        // tab (models/[id]) — the standalone page carried its own model
        // picker, which is redundant once a model is already selected.
        source: '/models/monitoring',
        destination: '/models/views',
        permanent: false,
      },
    ]
  },
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
