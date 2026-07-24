"use client";

import { useCallback, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SecurityAuditWorkspace } from "@/components/modules/security-audit-workspace";
import { SecurityAuditHistoryPanel } from "@/components/modules/security-audit-history";
import { UiTestingSegmented } from "@/components/modules/ui-testing-segmented";
import { api, type Job, type SecurityAuditHistoryItem } from "@/lib/api";
import { toast } from "sonner";

const MODE_OPTIONS = [
  { value: "single" as const, label: "Single Page" },
  { value: "full" as const, label: "Full Website" },
];

function SecurityAuditPanel({
  mode,
  onModeChange,
  historyRefreshKey,
  onHistoryRefresh,
}: {
  mode: "single" | "full";
  onModeChange: (mode: "single" | "full") => void;
  historyRefreshKey: number;
  onHistoryRefresh: () => void;
}) {
  const [historyJob, setHistoryJob] = useState<Job | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const testType = mode === "full" ? "full-website" : "single-page";

  const handleSelectReport = useCallback(async (item: SecurityAuditHistoryItem) => {
    try {
      const { job } = await api.getJob(item.moduleId, item.id);
      setHistoryJob(job);
      setSelectedHistoryId(item.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load report");
    }
  }, []);

  return (
    <div className="security-audit-stack flex w-full flex-col gap-6">
      <SecurityAuditWorkspace
        mode={mode}
        onHistoryRefresh={onHistoryRefresh}
        historyJob={historyJob}
        onHistoryJobClear={() => {
          setHistoryJob(null);
          setSelectedHistoryId(null);
        }}
      />

      <SecurityAuditHistoryPanel
        testType={testType}
        onTestTypeChange={(type) => onModeChange(type === "full-website" ? "full" : "single")}
        onSelectReport={handleSelectReport}
        onReportDeleted={(jobId) => {
          if (selectedHistoryId === jobId) {
            setHistoryJob(null);
            setSelectedHistoryId(null);
          }
        }}
        refreshKey={historyRefreshKey}
        selectedJobId={selectedHistoryId}
      />
    </div>
  );
}

export default function SecurityAuditPage() {
  const [mode, setMode] = useState<"single" | "full">("single");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const refreshHistory = useCallback(() => {
    setHistoryRefreshKey((k) => k + 1);
  }, []);

  return (
    <AppShell title="Security Audit" subtitle="PageSpeed, W3C validation, robots.txt, and redirect tracing">
      <div className="security-audit-page mx-auto w-full max-w-[1100px] px-0 md:px-6">
        <div className="mb-6 flex justify-center">
          <UiTestingSegmented
            value={mode}
            options={MODE_OPTIONS}
            onChange={setMode}
            aria-label="Audit mode"
          />
        </div>

        {mode === "single" ? (
          <SecurityAuditPanel
            key="single"
            mode="single"
            onModeChange={setMode}
            historyRefreshKey={historyRefreshKey}
            onHistoryRefresh={refreshHistory}
          />
        ) : (
          <SecurityAuditPanel
            key="full"
            mode="full"
            onModeChange={setMode}
            historyRefreshKey={historyRefreshKey}
            onHistoryRefresh={refreshHistory}
          />
        )}
      </div>
    </AppShell>
  );
}