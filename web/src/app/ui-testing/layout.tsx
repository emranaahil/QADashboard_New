import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("ui-testing");

export default function UiTestingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
