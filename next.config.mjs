import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Trigger dev server restart to clear global HMR and singleton cache
/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_CLOUD_DOCS_INGEST:
      process.env.VERCEL === "1" ||
      process.env.CONTAINER === "1" ||
      process.env.DOCS_USE_CLOUD === "1"
        ? "1"
        : "0",
  },
  // Produces a self-contained .next/standalone build (server.js + only the
  // node_modules actually used) — this is what the Azure VM Dockerfile
  // copies out; without it the container image ships the full dev
  // node_modules tree and `next start` instead of the trimmed server.
  output: "standalone",
  serverExternalPackages: ['sqlite3', 'pdf-parse', 'mammoth', 'pdfjs-dist'],
  outputFileTracingIncludes: {
    '/api/**/*': [
      './node_modules/pdf-parse/**/*',
      './src/data/employee-accounts.json',
      './src/data/employee_test_manifest.json',
    ],
  },
  turbopack: {
    root: __dirname,
  },
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'framer-motion'
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://cfqpdjpvzgkvpipainzp.supabase.co; frame-ancestors 'none';"
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=()'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          }
        ]
      }
    ];
  },
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: /node_modules|\.git|\.next|uploads/,
      };
    }
    return config;
  },
};

export default nextConfig;
