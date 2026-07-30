import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("sitemap-check");

export default function SitemapCheckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
