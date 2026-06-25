"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { moduleReportHtmlUrl } from "@/lib/radar-report-utils";
import { toast } from "sonner";

type RadarReportPanelProps = {
  moduleId: string;
  reportId: string;
  onExportCsv: () => void;
  onCopyLinks: () => Promise<void>;
  hasData: boolean;
};

export function RadarReportPanel({
  moduleId,
  reportId,
  onExportCsv,
  onCopyLinks,
  hasData,
}: RadarReportPanelProps) {
  const htmlUrl = useMemo(
    () => moduleReportHtmlUrl(moduleId, reportId),
    [moduleId, reportId]
  );

  const openHtml = () => {
    window.open(htmlUrl, "_blank", "noopener,noreferrer");
  };

  const handleCopy = async () => {
    try {
      await onCopyLinks();
      toast.success("Links copied to clipboard");
    } catch {
      toast.error("Failed to copy links");
    }
  };

  const handleExport = () => {
    if (!hasData) {
      toast.error("No data to export");
      return;
    }
    onExportCsv();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={openHtml}>
          Open HTML Report
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={handleExport} disabled={!hasData}>
          Export CSV
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={handleCopy} disabled={!hasData}>
          Copy All Links
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
        <iframe
          key={htmlUrl}
          title="Report"
          src={htmlUrl}
          className="h-[min(70vh,720px)] w-full border-0 bg-background"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  );
}