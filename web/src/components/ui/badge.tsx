import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors duration-250",
  {
    variants: {
      variant: {
        default: "border-[rgba(15,143,111,0.35)] bg-[rgba(15,143,111,0.15)] text-[#86efac]",
        success: "border-[rgba(34,197,94,0.4)] bg-[rgba(34,197,94,0.2)] text-[#86efac]",
        failed: "border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.2)] text-[#fca5a5]",
        running: "border-[rgba(59,130,246,0.4)] bg-[rgba(59,130,246,0.2)] text-[#93c5fd]",
        warning: "border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.2)] text-[#fcd34d]",
        secondary: "border-border bg-card text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant: variant ?? "default" }), className)} {...props} />
  );
}

export function statusBadgeVariant(
  status?: string | null
): "success" | "failed" | "running" | "warning" | "secondary" {
  const s = String(status || "").toLowerCase();
  if (s === "completed" || s === "done") return "success";
  if (s === "failed") return "failed";
  if (s === "cancelled") return "warning";
  if (s === "running" || s === "pending" || s === "starting") return "running";
  return "secondary";
}