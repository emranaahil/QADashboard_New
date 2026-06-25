"use client";

import type { LucideIcon } from "lucide-react";
import { Link2, Monitor, Radar, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGlobalWorkBusy } from "@/hooks/use-global-work-busy";
import { cn } from "@/lib/utils";

export type RunModuleKind = "ui-test" | "seo-test" | "keyword-scan" | "link-check";

const MODULE_ICONS: Record<RunModuleKind, LucideIcon> = {
  "ui-test": Monitor,
  "seo-test": Search,
  "keyword-scan": Radar,
  "link-check": Link2,
};

type RunModuleButtonProps = {
  kind: RunModuleKind;
  label: string;
  loadingLabel: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
};

export function RunModuleButton({
  kind,
  label,
  loadingLabel,
  loading = false,
  disabled = false,
  onClick,
  className,
}: RunModuleButtonProps) {
  const Icon = MODULE_ICONS[kind];
  const globalBusy = useGlobalWorkBusy();
  const blocked = globalBusy && !loading;

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