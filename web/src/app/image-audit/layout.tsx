import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("image-audit");

export default function ImageAuditLayout({ children }: { children: React.ReactNode }) {
  return children;
}
