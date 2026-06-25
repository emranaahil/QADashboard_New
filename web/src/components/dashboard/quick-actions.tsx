"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useExecutionStore } from "@/store/execution-store";
import { useScanStore } from "@/store/scan-store";
import {
  MAX_URL_LENGTH,
  validateKeywords,
  validateUrl,
} from "@/lib/url-validation";

export function QuickActions() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [keywordsText, setKeywordsText] = useState("");

  const jobStatus = useExecutionStore((s) => s.status);
  const jobModuleId = useExecutionStore((s) => s.moduleId);
  const jobProgress = useExecutionStore((s) => s.progress);
  const jobMessage = useExecutionStore((s) => s.message);
  const jobCancelling = useExecutionStore((s) => s.isCancelling);
  const startJob = useExecutionStore((s) => s.startJob);
  const cancelJob = useExecutionStore((s) => s.cancelJob);

  const scanStatus = useScanStore((s) => s.status);
  const scanModuleId = useScanStore((s) => s.moduleId);
  const scanProgress = useScanStore((s) => s.progress);
  const scanMessage = useScanStore((s) => s.message);
  const scanCancelling = useScanStore((s) => s.isCancelling);
  const startKeywordScan = useScanStore((s) => s.startKeywordScan);
  const startErrorCheck = useScanStore((s) => s.startErrorCheck);
  const cancelScan = useScanStore((s) => s.cancelScan);

  const jobRunning = jobStatus === "running" || jobCancelling;
  const scanRunning = scanStatus === "running" || scanCancelling;
  const globalRunning = jobRunning || scanRunning;

  const activeModuleId = jobRunning ? jobModuleId : scanRunning ? scanModuleId : null;
  const progress = jobRunning ? jobProgress : scanProgress;
  const message = jobRunning ? jobMessage : scanMessage;
  const isCancelling = jobRunning ? jobCancelling : scanCancelling;

  const runIfValid = (fn: () => void) => {
    const urlError = validateUrl(url);
    if (urlError) {
      toast.error(urlError);
      return;
    }
    fn();
  };

  const handleUiTest = () => {
    runIfValid(() =>
      startJob({
        moduleId: "ui-check",
        url,
        options: { devices: ["desktop"], browser: "chrome" },
        source: "quick_actions",
        successMessage: "UI Test completed successfully",
      })
    );
  };

  const handleSeoTest = () => {
    runIfValid(() =>
      startJob({
        moduleId: "seo",
        url,
        options: { mode: "single" },
        source: "quick_actions",
        successMessage: "SEO Test completed successfully",
      })
    );
  };

  const handleKeywordScan = () => {
    const urlError = validateUrl(url);
    if (urlError) {
      toast.error(urlError);
      return;
    }
    const { keywords, error } = validateKeywords(keywordsText);
    if (error) {
      toast.error(error);
      return;
    }
    startKeywordScan(url, keywords);
  };

  const handleLinkCheck = () => {
    runIfValid(() => startErrorCheck(url, { maxUrls: 100, maxDepth: 5 }));
  };

  const handleCancel = () => {
    if (jobRunning) cancelJob();
    else if (scanRunning) cancelScan();
  };

  return (
    <Card className="w-full lg:w-80">
      <CardHeader className="pb-3">
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">URL</label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            aria-label="Test URL"
            disabled={globalRunning}
            maxLength={MAX_URL_LENGTH}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Keywords (one per line, for Keyword Radar)
          </label>
          <textarea
            className="min-h-[72px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            disabled={globalRunning}
            placeholder={"brand\nproduct"}
          />
        </div>

        <Button
          className="w-full"
          loading={jobRunning && jobModuleId === "ui-check" && !isCancelling}
          disabled={globalRunning}
          onClick={handleUiTest}
        >
          Run UI Test
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          loading={jobRunning && jobModuleId === "seo" && !isCancelling}
          disabled={globalRunning}
          onClick={handleSeoTest}
        >
          Run SEO Test
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          loading={scanRunning && scanModuleId === "keyword-check" && !isCancelling}
          disabled={globalRunning}
          onClick={handleKeywordScan}
        >
          Run Keyword Scan
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          loading={scanRunning && scanModuleId === "error-check" && !isCancelling}
          disabled={globalRunning}
          onClick={handleLinkCheck}
        >
          Run Link Check
        </Button>

        {globalRunning && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground">
              {progress}% · {activeModuleId}
            </p>
            {message && <p className="truncate text-xs text-muted-foreground">{message}</p>}
            <Button variant="cancel" size="sm" loading={isCancelling} disabled={isCancelling} onClick={handleCancel}>
              {isCancelling ? "Cancelling…" : "Cancel"}
            </Button>
          </div>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            router.push("/history");
            toast.info("Opening execution history");
          }}
        >
          View History
        </Button>
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => {
            router.push("/reports");
            toast.info("Opening reports center");
          }}
        >
          Reports Center
        </Button>
      </CardContent>
    </Card>
  );
}