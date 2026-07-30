"use client";

import { Toaster } from "sonner";

/** Client component — safe to import from the server root layout. */
export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      closeButton
      richColors={false}
      expand={false}
      toastOptions={{
        duration: 4000,
        classNames: {
          toast: "glass-panel border-border text-foreground",
          success:
            "border-[rgba(34,197,94,0.4)] bg-[rgba(34,197,94,0.14)] text-[#86efac]",
          error:
            "border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.14)] text-[#fca5a5]",
          warning:
            "border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.14)] text-[#fcd34d]",
          info: "border-[rgba(59,130,246,0.4)] bg-[rgba(59,130,246,0.14)] text-[#93c5fd]",
        },
      }}
    />
  );
}
