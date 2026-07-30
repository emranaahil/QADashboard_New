"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { ApiBanner } from "./api-banner";
import { ExecutionDrawer } from "./execution-drawer";
import { ScanResumeBootstrap } from "./scan-resume-bootstrap";
import { JobResumeBootstrap } from "./job-resume-bootstrap";
import { SessionBootstrap } from "./session-bootstrap";

/**
 * Static client imports only — next/dynamic factories were throwing
 * "Cannot read properties of undefined (reading 'call')" in the browser.
 */
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

      <div className="relative flex min-w-0 flex-1 flex-col">
        <ApiBanner />
        <div className="relative z-50 shrink-0">
          <TopBar
            title={title}
            subtitle={subtitle}
            onMenuClick={() => setMobileOpen(true)}
          />
        </div>
        <main className="relative z-0 flex-1 overflow-auto px-5 pb-24 pt-4">{children}</main>
        <ExecutionDrawer />
        <SessionBootstrap />
        <JobResumeBootstrap />
        <ScanResumeBootstrap />
      </div>
    </div>
  );
}
