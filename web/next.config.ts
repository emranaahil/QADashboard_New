import type { NextConfig } from "next";
import path from "path";

const API_URL = process.env.API_URL || "http://127.0.0.1:3000";
const IS_PROD = process.env.NODE_ENV === "production";

/**
 * Security headers for the Next.js UI (public Render port).
 * Production CSP is strict enough for same-origin /api rewrites.
 * Dev CSP also allows local http API (localhost / 127.0.0.1) if absolute URLs are used.
 */
function buildSecurityHeaders() {
  const connectSrc = IS_PROD
    ? ["'self'", "https:", "wss:", "ws:"].join(" ")
    : [
        "'self'",
        "http://127.0.0.1:*",
        "http://localhost:*",
        "https:",
        "wss:",
        "ws:",
      ].join(" ");

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // Next.js requires inline scripts/styles in App Router
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
  ];
  if (IS_PROD) {
    csp.push("upgrade-insecure-requests");
  }

  const headers = [
    { key: "Content-Security-Policy", value: csp.join("; ") },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "X-DNS-Prefetch-Control", value: "on" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];

  if (IS_PROD) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
      {
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
