"use client";

import { useEffect, useState } from "react";
import { AppToaster } from "@/components/providers/app-toaster";

/**
 * Client-only UI chrome that must not participate in SSR HTML
 * (avoids hydration attribute mismatches).
 */
export function ClientProviders({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      {children}
      {mounted ? <AppToaster /> : null}
    </>
  );
}
