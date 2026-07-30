import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("keyword-radar");

export default function KeywordRadarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
