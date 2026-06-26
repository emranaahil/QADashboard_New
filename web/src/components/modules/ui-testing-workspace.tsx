"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RunModuleButton } from "@/components/execution/run-module-button";
import { StatusWithReport } from "@/components/execution/status-with-report";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { BrowserSelector } from "@/components/modules/browser-selector";
import {
  DeviceSelector,
  type CustomDevice,
  type DeviceSelectorHandle,
} from "@/components/modules/device-selector";
import { useGlobalWorkBusy } from "@/hooks/use-global-work-busy";
import { useJobRunner } from "@/hooks/use-job-runner";
import { api, type Job } from "@/lib/api";
import { fallbackSummary, loadUiTestSummary, type UiTestSummary } from "@/lib/ui-testing-summary";
import { canViewLogs } from "@/lib/logs";
import { parseUrlListInput, validateUrlListInput } from "@/lib/parse-url-list";
import { MAX_URL_LENGTH, validateUrl } from "@/lib/url-validation";
import {
  DEFAULT_MAX_PAGES,
  LIVE_HARD_CAP,
  WARN_ABOVE_PAGES,
  parseMaxPagesInput,
} from "@/lib/full-ui-limits";
import { toast } from "sonner";

type Mode = "single" | "full";

type Props = {
  mode: Mode;
  onHistoryRefresh: () => void;
  historyJob: Job | null;
  onHistoryJobClear: () => void;
};

function StatCard({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  return (
    <div className="hover-lift flex h-24 flex-col items-center justify-center rounded-[14px] border border-border bg-background-elevated px-3 text-center">
      <div className={`text-xl font-bold leading-tight ${highlight ? "text-amber-400" : ""}`}>{value}</div>
      <div className="mt-1 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

const UI_CHECK_CARD =
  "ui-check-card w-full min-h-[320px] rounded-[20px] border-border p-8";

export function UiTestingWorkspace({
  mode,
  onHistoryRefresh,
  historyJob,
  onHistoryJobClear,
}: Props) {
  const [url, setUrl] = useState("");
  const [summary, setSummary] = useState<UiTestSummary | null>(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [customDevices, setCustomDevices] = useState<CustomDevice[]>([]);
  const [devicesReady, setDevicesReady] = useState(false);
  const [maxPages, setMaxPages] = useState(String(DEFAULT_MAX_PAGES));
  const [selectedBrowser, setSelectedBrowser] = useState("chrome");
  const moduleId = mode === "full" ? "full-ui-check" : "ui-check";
  const globalBusy = useGlobalWorkBusy();
  const deviceSelectorRef = useRef<DeviceSelectorHandle>(null);

  const runner = useJobRunner({
    moduleId,
    successMessage: "UI Test completed successfully",
    source: "ui_test",
    onComplete: onHistoryRefresh,
  });

  const activeJob = runner.isActive ? runner.job : historyJob;
  const displayModuleId = runner.isActive ? moduleId : historyJob?.moduleId || moduleId;

  const workflow = useMemo(() => {
    if (runner.running || runner.isCancelling) return "running";
    if (runner.isActive && (runner.status === "completed" || runner.status === "failed")) return "complete";
    if (historyJob && !runner.running) return "complete";
    return "idle";
  }, [runner.running, runner.isCancelling, runner.isActive, runner.status, historyJob]);

  const displayStatus = runner.isActive ? runner.status : historyJob?.status;

  useEffect(() => {
    if (devicesReady) return;
    api
      .getDevices()
      .then((res) => {
        const ids = (res.devices || []).map((d) => d.id);
        const defaultId = ids.includes("desktop") ? "desktop" : ids[0] || "desktop";
        setSelectedDeviceIds([defaultId]);
        setDevicesReady(true);
      })
      .catch(() => {
        setSelectedDeviceIds(["desktop"]);
        setDevicesReady(true);
      });
  }, [devicesReady]);

  const resolvedDeviceCount = useCallback((job: Job) => {
    const resolved = job.options?._resolvedDevices;
    if (Array.isArray(resolved) && resolved.length) return resolved.length;
    const selected = job.options?.devices;
    if (Array.isArray(selected) && selected.length) return selected.length;
    return 1;
  }, []);

  const loadSummary = useCallback(async (job: Job, modId: string) => {
    const base = fallbackSummary({
      totalPages: job.totalPages,
      completed: job.status === "completed",
      deviceCount: resolvedDeviceCount(job),
    });
    if (job.status === "completed" && job.reportAvailable && job.id) {
      const loaded = await loadUiTestSummary(modId, job.id, base);
      setSummary(loaded);
    } else {
      setSummary(base);
    }
  }, [resolvedDeviceCount]);

  useEffect(() => {
    if (historyJob?.url) setUrl(historyJob.url);
    const historyBrowser = historyJob?.options?.browser;
    if (typeof historyBrowser === "string" && ["chrome", "firefox", "safari"].includes(historyBrowser)) {
      const liveOnlyChrome =
        process.env.NODE_ENV === "production" && historyBrowser !== "chrome";
      setSelectedBrowser(liveOnlyChrome ? "chrome" : historyBrowser);
    }
  }, [historyJob]);

  useEffect(() => {
    if (workflow === "complete" && activeJob) {
      loadSummary(activeJob, displayModuleId);
    } else if (workflow !== "complete") {
      setSummary(null);
    }
  }, [workflow, activeJob, displayModuleId, loadSummary]);

  const handleRun = () => {
    const validationError =
      mode === "single" ? validateUrlListInput(url) : validateUrl(url);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const devices = deviceSelectorRef.current?.getDevicesForRun();
    if (!devices?.length) return;

    let pages = DEFAULT_MAX_PAGES;
    let startUrl = url.trim();
    const runOptions: Record<string, unknown> = {
      devices,
      browser: selectedBrowser,
    };

    if (mode === "full") {
      pages = parseMaxPagesInput(maxPages);
      if (pages > WARN_ABOVE_PAGES) {
        toast.warning(
          `Testing more than ${WARN_ABOVE_PAGES} pages may not complete on the live server. ` +
            `${LIVE_HARD_CAP} is the maximum on production.`
        );
      }
      runOptions.maxPages = pages;
    } else {
      const parsed = parseUrlListInput(url);
      startUrl = parsed.primaryUrl;
      if (parsed.urls.length > 1) {
        runOptions.urls = parsed.urls;
      }
    }

    onHistoryJobClear();
    setSummary(null);
    runner.start(startUrl, runOptions);
  };

  const pagesLabel =
    runner.totalPages > 0
      ? mode === "single" && runner.totalPages > 1
        ? `URL ${runner.currentPage} / ${runner.totalPages}`
        : `${runner.currentPage} / ${runner.totalPages} Pages`
      : runner.running
        ? `${runner.progress}%`
        : "—";

  const showViewLog =
    canViewLogs(displayStatus) && !!displayModuleId && !!activeJob?.id;

  return (
    <div className="ui-check-container flex w-full flex-col gap-6">
      <Card className={UI_CHECK_CARD}>
        <h2 className="text-lg font-bold leading-tight">
          {mode === "full" ? "Full Website UI Check" : "Single Page UI Check"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "full"
            ? "Enter a URL and run visual QA checks across your selected devices."
            : "Enter one URL, or several separated by commas — all tested in one run with a single report."}
        </p>

        <label className="mb-2 mt-4 block text-xs font-semibold text-muted-foreground">
          {mode === "single" ? "URL(s)" : "URL"}
        </label>
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            mode === "single"
              ? "https://example.com, example.com/login, example.com/about"
              : "https://example.com"
          }
          disabled={globalBusy}
          maxLength={MAX_URL_LENGTH}
          className="mb-0 h-11 w-full rounded-lg text-sm"
        />

        <div className="mt-4 space-y-4 rounded-xl border border-border bg-background-elevated/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Run configuration
          </p>

          {mode === "full" && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Max pages</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[DEFAULT_MAX_PAGES, WARN_ABOVE_PAGES, LIVE_HARD_CAP].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={globalBusy}
                      onClick={() => setMaxPages(String(preset))}
                      className={`rounded-lg border px-2.5 py-1 text-[0.68rem] font-medium transition-colors ${
                        maxPages === String(preset)
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                  <Input
                    type="number"
                    min={1}
                    max={LIVE_HARD_CAP}
                    value={maxPages}
                    onChange={(e) => setMaxPages(e.target.value)}
                    disabled={globalBusy}
                    aria-label="Max pages to test"
                    className="mb-0 h-8 w-[4.5rem] rounded-lg px-2 text-center text-sm"
                  />
                </div>
              </div>
              <p className="text-[0.68rem] text-muted-foreground">
                Default {DEFAULT_MAX_PAGES} pages. More than {WARN_ABOVE_PAGES} may fail on live hosting.
              </p>
            </div>
          )}

          {mode === "full" ? <div className="border-t border-border/60" /> : null}

          <BrowserSelector
            value={selectedBrowser}
            onChange={setSelectedBrowser}
            disabled={globalBusy}
            mode={mode}
            compact
          />

          <div className="border-t border-border/60" />

          <DeviceSelector
            ref={deviceSelectorRef}
            selectedIds={selectedDeviceIds}
            onSelectedIdsChange={setSelectedDeviceIds}
            customDevices={customDevices}
            onCustomDevicesChange={setCustomDevices}
            disabled={globalBusy}
            showMultiDeviceWarning={mode === "full"}
            compact
          />
        </div>

        <div className="run-test-actions mt-6 flex flex-wrap gap-3">
          <RunModuleButton
            kind="ui-test"
            label="Run Test"
            loadingLabel="Running…"
            loading={runner.running && !runner.isCancelling}
            disabled={runner.isCancelling}
            onClick={handleRun}
          />
          {(runner.running || runner.isCancelling) && (
            <Button
              variant="cancel"
              className="h-11 min-w-[140px] flex-1 rounded-lg px-4 sm:flex-none"
              loading={runner.isCancelling}
              disabled={runner.isCancelling}
              onClick={runner.cancel}
            >
              {runner.isCancelling ? "Cancelling…" : "Cancel Test"}
            </Button>
          )}
        </div>
      </Card>

      {workflow === "running" && (
        <Card className={`${UI_CHECK_CARD} min-h-0`} aria-live="polite">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold leading-tight">Execution</h3>
            <Badge variant={statusBadgeVariant("running")} className="shrink-0 uppercase">
              running
            </Badge>
          </div>
          <Progress value={runner.progress} className="mb-2 h-2 rounded-full" />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{runner.progress}%</span>
            <span>{pagesLabel}</span>
          </div>
          {runner.message && (
            <p className="mt-3 break-words text-sm text-muted-foreground">{runner.message}</p>
          )}
          {showViewLog && activeJob?.id && (
            <div className="mt-4">
              <ViewLogButton
                kind="job"
                moduleId={displayModuleId}
                jobId={activeJob.id}
                size="sm"
                className="h-10 rounded-lg"
              />
            </div>
          )}
        </Card>
      )}

      {workflow === "complete" && activeJob && summary && (
        <Card className={`${UI_CHECK_CARD} min-h-0`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold leading-tight">Results Summary</h3>
            {displayStatus ? (
              <StatusWithReport
                status={displayStatus}
                moduleId={displayModuleId}
                jobId={activeJob.id}
                reportAvailable={activeJob.reportAvailable}
              />
            ) : null}
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard value={summary.pages} label="Pages Scanned" />
            <StatCard value={summary.checks} label="Checks Run" />
            <StatCard value={summary.issues} label="Issues Found" highlight={summary.issues > 0} />
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            Duration:{" "}
            <strong className="text-foreground">
              {activeJob.durationMs ? `${Math.round(activeJob.durationMs / 1000)}s` : "—"}
            </strong>
          </p>

          {activeJob.error && (
            <p className="mb-4 text-sm text-destructive">{activeJob.error}</p>
          )}

          <div className="flex flex-wrap gap-3">
            {showViewLog && (
              <ViewLogButton
                kind="job"
                moduleId={displayModuleId}
                jobId={activeJob.id}
                className="h-11 rounded-lg"
              />
            )}
            <Button
              variant="secondary"
              className="h-11 rounded-lg px-4"
              disabled={globalBusy}
              onClick={handleRun}
            >
              Re-run Test
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}