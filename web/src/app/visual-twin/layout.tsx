import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("visual-twin");

export default function VisualTwinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
