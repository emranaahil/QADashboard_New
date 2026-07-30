import type { NextConfig } from "next";
import path from "path";

const API_URL = process.env.API_URL || "http://127.0.0.1:3000";

/**
 * Security headers for the Next.js UI (served on the public Render port).
 * Aligns with render.yaml headers; app-level headers still apply if the
 * Blueprint header map is not used.
 *
 * CSP is intentionally compatible with Next.js (inline scripts/styles).
 * Tighten further once you verify the production build under CSP.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss: ws:",
      "worker-src 'self' blob:",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Static assets can be cached longer at the edge / browser
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      { source: "/modules/ui-check", destination: "/ui-testing", permanent: true },
      { source: "/modules/full-ui-check", destination: "/ui-testing", permanent: true },
      { source: "/modules/seo", destination: "/seo-testing", permanent: true },
      { source: "/modules/keyword-check", destination: "/keyword-radar", permanent: true },
      { source: "/modules/error-check", destination: "/link-radar", permanent: true },
      { source: "/modules/sitemap-check", destination: "/sitemap-check", permanent: true },
      { source: "/modules/image-audit", destination: "/image-audit", permanent: true },
      { source: "/modules/security-audit", destination: "/security-audit", permanent: true },
      { source: "/linkradar", destination: "/link-radar", permanent: true },
    ];
  },
};

export default nextConfig;