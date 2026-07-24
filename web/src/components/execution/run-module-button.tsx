"use client";

import type { LucideIcon } from "lucide-react";
import { ImageIcon, Link2, Map, Monitor, Radar, Search, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModuleWorkBusy } from "@/hooks/use-global-work-busy";
import { cn } from "@/lib/utils";

export type RunModuleKind =
  | "ui-test"
  | "seo-test"
  | "keyword-scan"
  | "link-check"
  | "sitemap-check"
  | "image-audit"
  | "security-audit";

const MODULE_ICONS: Record<RunModuleKind, LucideIcon> = {
  "ui-test": Monitor,
  "seo-test": Search,
  "keyword-scan": Radar,
  "link-check": Link2,
  "sitemap-check": Map,
  "image-audit": ImageIcon,
  "security-audit": Shield,
};

type RunModuleButtonProps = {
  kind: RunModuleKind;
  /** Job or scan module id — enables per-module busy lock in local parallel mode. */
  busyModuleId?: string;
  label: string;
  loadingLabel: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
};

export function RunModuleButton({
  kind,
  busyModuleId,
  label,
  loadingLabel,
  loading = false,
  disabled = false,
  onClick,
  className,
}: RunModuleButtonProps) {
  const Icon = MODULE_ICONS[kind];
  const moduleBusy = useModuleWorkBusy(busyModuleId);
  const blocked = moduleBusy && !loading;

  return (
    <Button
      type="button"
      className={cn(
        "run-module-btn h-11 min-w-[140px] flex-1 rounded-lg px-4 sm:flex-none",
        className
      )}
      loading={loading}
      disabled={disabled || loading || blocked}
      onClick={onClick}
    >
      {!loading ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      {loading ? loadingLabel : label}
    </Button>
  );
}