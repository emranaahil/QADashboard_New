"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RunModuleButton } from "@/components/execution/run-module-button";
import { RunTestActionsPanel } from "@/components/execution/run-test-actions-panel";
import { StatusWithReport } from "@/components/execution/status-with-report";
import { ViewLogButton } from "@/components/execution/view-log-button";
import { ViewReportButton } from "@/components/execution/view-report-button";
import { canViewReport } from "@/lib/report";
import { BrowserSelector } from "@/components/modules/browser-selector";
import {
  DeviceSelector,
  type CustomDevice,
  type DeviceSelectorHandle,
} from "@/components/modules/device-selector";
import { useModuleWorkBusy } from "@/hooks/use-global-work-busy";
import { useJobRunner } from "@/hooks/use-job-runner";
import { api, type Job } from "@/lib/api";
import { canViewLogs } from "@/lib/logs";
import { validateUrl } from "@/lib/url-validation";
import { cn } from "@/lib/utils";
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

const UI_CHECK_CARD =
  "ui-check-card w-full min-h-[320px] rounded-[20px] border-border p-8";

const MODULE_ID = "visual-twin";

function StatCard({
  value,
  label,
  highlight,
}: {
  value: number | string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className="hover-lift flex h-24 flex-col items-center justify-center rounded-[14px] border border-border bg-background-elevated px-3 text-center">
      <div className={`text-xl font-bold leading-tight ${highlight ? "text-amber-400" : ""}`}>
        {value}
      </div>
      <div className="mt-1 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function VisualTwinWorkspace({
  mode,
  onHistoryRefresh,
  historyJob,
  onHistoryJobClear,
}: Props) {
  const [referenceUrl, setReferenceUrl] = useState("");
  const [candidateUrl, setCandidateUrl] = useState("");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [customDevices, setCustomDevices] = useState<CustomDevice[]>([]);
  const [devicesReady, setDevicesReady] = useState(false);
  const [maxPages, setMaxPages] = useState(String(DEFAULT_MAX_PAGES));
  const [selectedBrowser, setSelectedBrowser] = useState("chrome");
  const [includeContactHyperlinks, setIncludeContactHyperlinks] = useState(false);
  const [phoneDigitLength, setPhoneDigitLength] = useState("10");
  const [summary, setSummary] = useState<{
    pairs: number;
    averageMatch: number;
    totalIssues: number;
    weakPairs: number;
  } | null>(null);

  const moduleBusy = useModuleWorkBusy(MODULE_ID);
  const deviceSelectorRef = useRef<DeviceSelectorHandle>(null);

  const runner = useJobRunner({
    moduleId: MODULE_ID,
    successMessage: "Visual Twin comparison completed",
    source: "visual_twin" as const,
    onComplete: onHistoryRefresh,
  });

  const activeJob = runner.isActive ? runner.job : historyJob;

  const workflow = useMemo(() => {
    if (runner.running || runner.isCancelling) return "running";
    if (runner.isActive && (runner.status === "completed" || runner.status === "failed")) {
      return "complete";
    }
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

  useEffect(() => {
    if (historyJob?.url) setReferenceUrl(historyJob.url);
    if (typeof historyJob?.options?.candidateUrl === "string") {
      setCandidateUrl(historyJob.options.candidateUrl);
    }
    if (typeof historyJob?.options?.referenceUrl === "string") {
      setReferenceUrl(historyJob.options.referenceUrl);
    }
    const historyBrowser = historyJob?.options?.browser;
    if (typeof historyBrowser === "string" && ["chrome", "firefox", "safari"].includes(historyBrowser)) {
      const liveOnlyChrome = process.env.NODE_ENV === "production" && historyBrowser !== "chrome";
      setSelectedBrowser(liveOnlyChrome ? "chrome" : historyBrowser);
    }
    if (historyJob?.options?.includeContactHyperlinks === true) {
      setIncludeContactHyperlinks(true);
    }
    if (historyJob?.options?.phoneDigitLength != null) {
      setPhoneDigitLength(String(historyJob.options.phoneDigitLength));
    }
  }, [historyJob]);

  const loadSummary = useCallback(async (job: Job) => {
    if (job.status !== "completed" || !job.reportAvailable || !job.id) {
      setSummary(null);
      return;
    }
    try {
      const report = await api.getReport(MODULE_ID, `job:${job.id}`);
      const data = report.data as {
        summary?: {
          pairCount?: number;
          averageMatch?: number;
          totalIssues?: number;
          weakPairs?: number;
        };
        pairs?: unknown[];
      };
      const s = data.summary;
      setSummary({
        pairs: s?.pairCount ?? data.pairs?.length ?? 0,
        averageMatch: s?.averageMatch ?? 0,
        totalIssues: s?.totalIssues ?? 0,
        weakPairs: s?.weakPairs ?? 0,
      });
    } catch {
      setSummary(null);
    }
  }, []);

  useEffect(() => {
    if (workflow === "complete" && activeJob) {
      void loadSummary(activeJob);
    } else if (workflow !== "complete") {
      setSummary(null);
    }
  }, [workflow, activeJob, loadSummary]);

  const handleRun = () => {
    const refErr = validateUrl(referenceUrl.trim());
    if (refErr) {
      toast.error(`Reference URL: ${refErr}`);
      return;
    }
    const candErr = validateUrl(candidateUrl.trim());
    if (candErr) {
      toast.error(`Candidate URL: ${candErr}`);
      return;
    }

    const devices = deviceSelectorRef.current?.getDevicesForRun();
    if (!devices?.length) return;

    if (includeContactHyperlinks) {
      const phoneLen = parseInt(phoneDigitLength, 10);
      if (!Number.isFinite(phoneLen) || phoneLen < 7 || phoneLen > 15) {
        toast.error("Phone digit length must be between 7 and 15.");
        return;
      }
    }

    const runOptions: Record<string, unknown> = {
      mode,
      referenceUrl: referenceUrl.trim(),
      candidateUrl: candidateUrl.trim(),
      devices,
      browser: selectedBrowser,
      includeContactHyperlinks,
    };
    if (includeContactHyperlinks) {
      runOptions.phoneDigitLength = parseInt(phoneDigitLength, 10);
    }
    if (mode === "full") {
      const pages = parseMaxPagesInput(maxPages);
      if (pages > WARN_ABOVE_PAGES) {
        toast.warning(
          `Comparing more than ${WARN_ABOVE_PAGES} pages may take a long time on live hosting.`
        );
      }
      runOptions.maxPages = pages;
    }

    onHistoryJobClear();
    setSummary(null);
    runner.start(referenceUrl.trim(), runOptions);
  };

  const showViewLog = canViewLogs(displayStatus) && !!activeJob?.id;
  const showViewReport =
    canViewReport({
      status: activeJob?.status ?? displayStatus,
      reportAvailable: activeJob?.reportAvailable,
    }) && !!activeJob?.id;

  return (
    <div className="ui-check-container flex w-full flex-col gap-6">
      <Card className={UI_CHECK_CARD}>
        <h2 className="text-lg font-bold leading-tight">
          {mode === "full" ? "Full Website Twin Compare" : "Single Page Twin Compare"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Compare a <strong className="text-foreground">reference</strong> site (source of truth)
          against a <strong className="text-foreground">candidate</strong> clone. Checks headings
          (H1–H6), paragraphs, header/footer/nav, images, and layout signals
          {mode === "full" ? " across discovered pages (path-mapped to the candidate)." : " for one URL pair."}
        </p>

        <label className="mb-2 mt-4 block text-xs font-semibold text-muted-foreground">
          Reference URL (original)
        </label>
        <Input
          type="url"
          value={referenceUrl}
          onChange={(e) => setReferenceUrl(e.target.value)}
          placeholder="https://original-site.com"
          disabled={moduleBusy}
          className="mb-0 h-11 w-full rounded-lg text-sm"
        />

        <label className="mb-2 mt-4 block text-xs font-semibold text-muted-foreground">
          Candidate URL (clone to verify)
        </label>
        <Input
          type="url"
          value={candidateUrl}
          onChange={(e) => setCandidateUrl(e.target.value)}
          placeholder="https://clone-site.com"
          disabled={moduleBusy}
          className="mb-0 h-11 w-full rounded-lg text-sm"
        />

        <div className="mt-4 space-y-4 rounded-xl border border-border bg-background-elevated/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Run configuration
          </p>

          {mode === "full" ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Max pages</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[DEFAULT_MAX_PAGES, WARN_ABOVE_PAGES, Math.min(LIVE_HARD_CAP, 50)].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={moduleBusy}
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
                    max={100}
                    value={maxPages}
                    onChange={(e) => setMaxPages(e.target.value)}
                    disabled={moduleBusy}
                    className="mb-0 h-8 w-[4.5rem] rounded-lg px-2 text-center text-sm"
                  />
                </div>
              </div>
              <p className="text-[0.68rem] text-muted-foreground">
                Crawls the reference site, then compares each path on the candidate host.
              </p>
            </div>
          ) : null}

          {mode === "full" ? <div className="border-t border-border/60" /> : null}

          <BrowserSelector
            value={selectedBrowser}
            onChange={setSelectedBrowser}
            disabled={moduleBusy}
            mode={mode}
            compact
          />

          <div className="border-t border-border/60" />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">Contact hyperlinks</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  On the candidate page, find email/phone text and check mailto:/tel: links.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={includeContactHyperlinks}
                aria-label="Toggle contact hyperlink checks"
                disabled={moduleBusy}
                onClick={() => setIncludeContactHyperlinks((p) => !p)}
                className={cn(
                  "relative h-8 w-[52px] shrink-0 rounded-full border border-border transition-all duration-250",
                  includeContactHyperlinks
                    ? "bg-[rgba(29,191,115,0.2)] border-[rgba(29,191,115,0.35)]"
                    : "bg-[rgba(7,26,18,0.45)]"
                )}
              >
                <span
                  className={cn(
                    "absolute top-1 h-6 w-6 rounded-full bg-foreground shadow-sm transition-all duration-250",
                    includeContactHyperlinks
                      ? "left-[calc(100%-1.75rem)] bg-[#1dbf73]"
                      : "left-1 bg-muted-foreground"
                  )}
                />
              </button>
            </div>
            {includeContactHyperlinks ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                <label className="text-xs font-semibold text-muted-foreground" htmlFor="vt-phone-len">
                  Phone digit length
                </label>
                <Input
                  id="vt-phone-len"
                  type="number"
                  min={7}
                  max={15}
                  value={phoneDigitLength}
                  onChange={(e) => setPhoneDigitLength(e.target.value)}
                  disabled={moduleBusy}
                  className="mb-0 h-8 w-[4.5rem] rounded-lg px-2 text-center text-sm"
                />
              </div>
            ) : null}
          </div>

          <div className="border-t border-border/60" />

          <DeviceSelector
            ref={deviceSelectorRef}
            selectedIds={selectedDeviceIds}
            onSelectedIdsChange={setSelectedDeviceIds}
            customDevices={customDevices}
            onCustomDevicesChange={setCustomDevices}
            disabled={moduleBusy}
            showMultiDeviceWarning={mode === "full"}
            compact
          />
        </div>

        <RunTestActionsPanel>
          <RunModuleButton
            kind="visual-twin"
            busyModuleId={MODULE_ID}
            label="Run Visual Twin"
            loadingLabel="Comparing…"
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
              {runner.isCancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
        </RunTestActionsPanel>
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
            <span>
              {runner.totalPages > 0
                ? `Pair ${runner.currentPage} / ${runner.totalPages}`
                : "—"}
            </span>
          </div>
          {runner.message ? (
            <p className="mt-3 break-words text-sm text-muted-foreground">{runner.message}</p>
          ) : null}
          {showViewLog && activeJob?.id ? (
            <div className="mt-4">
              <ViewLogButton
                kind="job"
                moduleId={MODULE_ID}
                jobId={activeJob.id}
                size="sm"
                className="h-10 rounded-lg"
              />
            </div>
          ) : null}
        </Card>
      )}

      {workflow === "complete" && activeJob && (
        <Card className={`${UI_CHECK_CARD} min-h-0`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold leading-tight">Results Summary</h3>
            {displayStatus ? (
              <StatusWithReport
                status={displayStatus}
                moduleId={MODULE_ID}
                jobId={activeJob.id}
                reportAvailable={activeJob.reportAvailable}
              />
            ) : null}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard value={summary?.pairs ?? "—"} label="Pairs Compared" />
            <StatCard
              value={summary != null ? `${summary.averageMatch}%` : "—"}
              label="Avg Match"
            />
            <StatCard
              value={summary?.weakPairs ?? "—"}
              label="Weak Pairs"
              highlight={(summary?.weakPairs ?? 0) > 0}
            />
            <StatCard
              value={summary?.totalIssues ?? "—"}
              label="Issues"
              highlight={(summary?.totalIssues ?? 0) > 0}
            />
          </div>

          {activeJob.error ? (
            <p className="mb-4 text-sm text-destructive">{activeJob.error}</p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {showViewReport ? (
              <ViewReportButton moduleId={MODULE_ID} jobId={activeJob.id} className="h-11 rounded-lg" />
            ) : null}
            {showViewLog ? (
              <ViewLogButton
                kind="job"
                moduleId={MODULE_ID}
                jobId={activeJob.id}
                className="h-11 rounded-lg"
              />
            ) : null}
            <Button
              variant="secondary"
              className="h-11 rounded-lg px-4"
              disabled={moduleBusy}
              onClick={handleRun}
            >
              Re-run Compare
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
