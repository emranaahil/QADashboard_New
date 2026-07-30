import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("link-radar");

export default function LinkRadarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
