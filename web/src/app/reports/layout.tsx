import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("reports");

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
