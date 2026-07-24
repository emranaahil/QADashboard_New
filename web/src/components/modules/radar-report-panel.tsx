"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [iframeLoading, setIframeLoading] = useState(true);

  const htmlUrl = useMemo(
    () => moduleReportHtmlUrl(moduleId, reportId),
    [moduleId, reportId]
  );

  useEffect(() => {
    setIframeError(null);
    setIframeLoading(true);
  }, [htmlUrl]);

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
      <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
        {iframeLoading ? (
          <p className="absolute inset-x-0 top-3 z-10 px-4 text-center text-xs text-muted-foreground">
            Loading report preview…
          </p>
        ) : null}
        {iframeError ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-destructive">{iframeError}</p>
            <Button type="button" size="sm" variant="secondary" onClick={openHtml}>
              Open HTML Report in new tab
            </Button>
          </div>
        ) : (
          <iframe
            key={htmlUrl}
            title="Report"
            src={htmlUrl}
            className="h-[min(70vh,720px)] w-full border-0 bg-background"
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            onLoad={(event) => {
              setIframeLoading(false);
              const iframe = event.currentTarget;
              try {
                const doc = iframe.contentDocument;
                if (!doc) {
                  setIframeError("Report preview is unavailable");
                  return;
                }
                const text = doc.body?.textContent?.trim() || "";
                if (text.startsWith("{") && text.includes('"error"')) {
                  try {
                    const parsed = JSON.parse(text) as { message?: string; error?: string };
                    setIframeError(parsed.message || parsed.error || "Failed to load report HTML");
                  } catch {
                    setIframeError("Failed to load report HTML");
                  }
                  return;
                }
                if (!text) {
                  setIframeError("Report HTML is empty or unavailable");
                }
              } catch {
                setIframeError("Report preview is unavailable");
              }
            }}
          />
        )}
      </div>
    </div>
  );
}