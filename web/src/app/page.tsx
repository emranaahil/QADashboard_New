import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pageMetadata } from "@/lib/site-seo";

export const metadata: Metadata = pageMetadata("home");

export default function Home() {
  redirect("/dashboard");
}
