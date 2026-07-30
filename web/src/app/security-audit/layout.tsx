import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("security-audit");

export default function SecurityAuditLayout({ children }: { children: React.ReactNode }) {
  return children;
}
