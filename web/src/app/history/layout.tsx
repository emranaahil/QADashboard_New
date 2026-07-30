import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("history");

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
