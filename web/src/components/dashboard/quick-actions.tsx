"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PrivacyDisclaimerNotice } from "@/components/layout/privacy-disclaimer-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  useExecutionStore,
  useModuleJob,
  useRunningModuleCount,
} from "@/store/execution-store";
import { useScanStore } from "@/store/scan-store";
import { isParallelExecutionEnabled } from "@/lib/parallel-execution";
import {
  MAX_URL_LENGTH,
  validateKeywords,
  validateUrl,
} from "@/lib/url-validation";

export function QuickActions() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [keywordsText, setKeywordsText] = useState("");

  const uiSlice = useModuleJob("ui-check");
  const seoSlice = useModuleJob("seo");
  const runningJobCount = useRunningModuleCount();
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

  const parallel = isParallelExecutionEnabled();
  const uiRunning = uiSlice.status === "running" || uiSlice.isCancelling;
  const seoRunning = seoSlice.status === "running" || seoSlice.isCancelling;
  const keywordRunning =
    scanModuleId === "keyword-check" && (scanStatus === "running" || scanCancelling);
  const linkRunning =
    scanModuleId === "error-check" && (scanStatus === "running" || scanCancelling);
  const scanRunning = scanStatus === "running" || scanCancelling;
  const anyRunning = runningJobCount > 0 || scanRunning;

  const activeModuleId = uiRunning
    ? "ui-check"
    : seoRunning
      ? "seo"
      : keywordRunning
        ? "keyword-check"
        : linkRunning
          ? "error-check"
          : null;
  const progress = uiRunning
    ? uiSlice.progress
    : seoRunning
      ? seoSlice.progress
      : scanProgress;
  const message = uiRunning ? uiSlice.message : seoRunning ? seoSlice.message : scanMessage;
  const isCancelling = uiRunning
    ? uiSlice.isCancelling
    : seoRunning
      ? seoSlice.isCancelling
      : scanCancelling;

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
        successMessage: "Seo/Geo Audit completed successfully",
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
    if (uiRunning) cancelJob("ui-check");
    else if (seoRunning) cancelJob("seo");
    else if (scanRunning) cancelScan();
  };

  const inputLocked = parallel ? false : anyRunning;

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
            disabled={inputLocked}
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
            disabled={inputLocked}
            placeholder={"brand\nproduct"}
          />
        </div>

        <PrivacyDisclaimerNotice />

        <Button
          className="w-full"
          loading={uiRunning && !uiSlice.isCancelling}
          disabled={parallel ? uiRunning : anyRunning}
          onClick={handleUiTest}
        >
          Run UI Test
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          loading={seoRunning && !seoSlice.isCancelling}
          disabled={parallel ? seoRunning : anyRunning}
          onClick={handleSeoTest}
        >
          Run Seo/Geo Audit
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          loading={keywordRunning && !scanCancelling}
          disabled={parallel ? keywordRunning : anyRunning}
          onClick={handleKeywordScan}
        >
          Run Keyword Scan
        </Button>
        <Button
          variant="secondary"
          className="w-full"
          loading={linkRunning && !scanCancelling}
          disabled={parallel ? linkRunning : anyRunning}
          onClick={handleLinkCheck}
        >
          Run Link Check
        </Button>

        {anyRunning && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
            <Progress value={progress} />
            <p className="text-xs text-muted-foreground">
              {progress}% · {parallel && runningJobCount > 1 ? `${runningJobCount} jobs` : activeModuleId}
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