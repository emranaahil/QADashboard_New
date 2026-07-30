import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("seo-testing");

export default function SeoTestingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
