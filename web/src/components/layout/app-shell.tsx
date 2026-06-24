"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

const ApiBanner = dynamic(() => import("./api-banner").then((m) => m.ApiBanner), { ssr: false });
const ExecutionDrawer = dynamic(
  () => import("./execution-drawer").then((m) => m.ExecutionDrawer),
  { ssr: false }
);

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/45 lg:hidden"
          aria-label="Close navigation menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <ApiBanner />
        <TopBar
          title={title}
          subtitle={subtitle}
          onMenuClick={() => setMobileOpen(true)}
        />
        <main className="flex-1 overflow-auto px-5 pb-24 pt-4">{children}</main>
        <ExecutionDrawer />
      </div>
    </div>
  );
}