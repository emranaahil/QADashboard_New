"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useDashboardStore } from "@/store/dashboard-store";
import { cn } from "@/lib/utils";

type DeleteReportButtonProps = {
  moduleId: string;
  reportId: string;
  label?: string;
  size?: "default" | "sm";
  variant?: "ghost" | "outline" | "destructive";
  className?: string;
  confirmMessage?: string;
  onDeleted?: () => void;
};

export function DeleteReportButton({
  moduleId,
  reportId,
  label = "Delete",
  size = "sm",
  variant = "ghost",
  className,
  confirmMessage = "Delete this report? This cannot be undone.",
  onDeleted,
}: DeleteReportButtonProps) {
  const [deleting, setDeleting] = useState(false);
  const bumpRefresh = useDashboardStore((s) => s.bumpRefresh);

  const handleDelete = async () => {
    if (deleting) return;
    if (!window.confirm(confirmMessage)) return;

    setDeleting(true);
    try {
      await api.deleteReport(moduleId, reportId);
      bumpRefresh();
      toast.success("Report deleted");
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete report");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn("gap-1.5 text-destructive hover:text-destructive", className)}
      onClick={handleDelete}
      disabled={deleting}
      title="Delete report"
      aria-label="Delete report"
    >
      <Trash2 className="h-4 w-4" />
      {label ? label : null}
    </Button>
  );
}