import type { NextConfig } from "next";
import path from "path";

const API_URL = process.env.API_URL || "http://127.0.0.1:3000";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
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
      { source: "/linkradar", destination: "/link-radar", permanent: true },
    ];
  },
};

export default nextConfig;