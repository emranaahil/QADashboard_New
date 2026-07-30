import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("dashboard");

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
